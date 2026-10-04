// ================================
// Private Chat - App
// ================================

const SUPABASE_URL = "https://fyxkmzkpoykroxsjjnzm.supabase.co";
const SUPABASE_KEY = "sb_publishable_djuZJaO1ZxDZOvMRW--5OQ_s_yCIOFo";

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);

let currentRoom = null;
let currentUser = null;
let realtimeChannel = null;


// ======================================================
// SAFE ELEMENT HELPER
// ======================================================

function $(id) {
    return document.getElementById(id);
}


// ======================================================
// PAGES
// ======================================================

function showPage(pageId) {
    document.querySelectorAll(".page, .chat-page").forEach(page => {
        page.classList.add("hidden");
    });

    const page = $(pageId);

    if (page) {
        page.classList.remove("hidden");
    }
}


if ($("createBtn")) {
    $("createBtn").addEventListener("click", () => {
        showPage("createPage");
    });
}

if ($("showJoinBtn")) {
    $("showJoinBtn").addEventListener("click", () => {
        showPage("joinPage");
    });
}


// ======================================================
// CREATE ROOM
// ======================================================

if ($("createRoomBtn")) {
    $("createRoomBtn").addEventListener("click", async () => {

        const password = $("createPassword")?.value.trim();

        if (!password) {
            alert("Password enter karo.");
            return;
        }

        const roomCode = generateRoomCode();

        const { data, error } = await supabaseClient
            .rpc("create_room", {
                p_code: roomCode,
                p_password: password
            })
            .single();

        if (error) {
            console.error(error);
            alert("ERROR: " + error.message);
            return;
        }

        currentRoom = data;

        if ($("newRoomCode")) {
            $("newRoomCode").textContent = roomCode;
        }

        if ($("createdRoom")) {
            $("createdRoom").classList.remove("hidden");
        }
    });
}


// ======================================================
// ENTER CREATED ROOM
// ======================================================

if ($("enterCreatedRoom")) {
    $("enterCreatedRoom").addEventListener("click", () => {

        let username = localStorage.getItem("chatUsername");

        if (!username) {

            username = prompt("Enter your name:");

            if (!username) return;

            username = username.trim();

            if (!username) return;

            localStorage.setItem("chatUsername", username);
        }

        currentUser = username;

        openChat();
    });
}


// ======================================================
// JOIN ROOM
// ======================================================

if ($("joinRoomBtn")) {
    $("joinRoomBtn").addEventListener("click", async () => {

        const roomCode = $("roomCode")?.value.trim().toUpperCase();
        const password = $("joinPassword")?.value.trim();
        const username = $("username")?.value.trim();

        if (!roomCode || !password || !username) {
            alert("Sab fields fill karo.");
            return;
        }

        const { data, error } = await supabaseClient
            .rpc("join_room", {
                p_code: roomCode,
                p_password: password
            })
            .maybeSingle();

        if (error || !data) {
            console.error(error);
            alert("Room not found.");
            return;
        }

        if (data.password !== password) {
            alert("Wrong password.");
            return;
        }

        currentRoom = data;
        currentUser = username;

        localStorage.setItem("chatUsername", username);

        openChat();
    });
}


// ======================================================
// OPEN CHAT
// ======================================================

async function openChat() {

    if (!currentRoom || !currentUser) {
        return;
    }

    showPage("chatPage");

    applyRoomHeader();

    if ($("roomLabel")) {
        $("roomLabel").textContent =
            `Room: ${currentRoom.room_code}`;
    }

    await loadMessages();

    await markSeen();

    subscribeToMessages();
}


// ======================================================
// LOAD MESSAGES
// ======================================================

async function loadMessages() {

    if (!currentRoom) return;

    const { data, error } = await supabaseClient
        .from("messages")
        .select("*")
        .eq("room_id", currentRoom.id)
        .order("created_at", {
            ascending: true
        });

    if (error) {
        console.error(error);
        return;
    }

    const container = $("messages");

    if (!container) return;

    container.innerHTML = "";

    (data || []).forEach(message => {
        displayMessage(message);
    });

    scrollMessages();
}


// ======================================================
// SEND MESSAGE
// ======================================================

if ($("messageForm")) {
    $("messageForm").addEventListener("submit", async event => {

        event.preventDefault();

        if (!currentRoom || !currentUser) {
            return;
        }

        const input = $("messageInput");

        if (!input) return;

        const text = input.value.trim();

        if (!text) return;

        const { error } = await supabaseClient
            .from("messages")
            .insert({
                room_id: currentRoom.id,
                username: currentUser,
                message: text,
                reply_to: replyingTo
            });

        if (error) {
            console.error(error);
            alert("Message could not be sent.");
            return;
        }

        input.value = "";

        clearReply();
    });
}


// ======================================================
// REALTIME
// ======================================================

function subscribeToMessages() {

    if (!currentRoom) return;

    if (realtimeChannel) {
        supabaseClient.removeChannel(realtimeChannel);
        realtimeChannel = null;
    }

    realtimeChannel = supabaseClient
        .channel(`room-${currentRoom.id}`, {
            config: {
                broadcast: {
                    self: false
                }
            }
        })

        // INSERT
        .on(
            "postgres_changes",
            {
                event: "INSERT",
                schema: "public",
                table: "messages",
                filter: `room_id=eq.${currentRoom.id}`
            },
            payload => {

                if (!currentRoom) return;

                displayMessage(payload.new);

                scrollMessages();

                if (
                    payload.new.username !== currentUser
                ) {
                    markSeen();
                }
            }
        )

        // DELETE
        .on(
            "postgres_changes",
            {
                event: "DELETE",
                schema: "public",
                table: "messages"
            },
            payload => {

                const el = document.querySelector(
                    `[data-message-id="${payload.old.id}"]`
                );

                if (el) {
                    el.remove();
                }
            }
        )

        // UPDATE
        .on(
            "postgres_changes",
            {
                event: "UPDATE",
                schema: "public",
                table: "messages",
                filter: `room_id=eq.${currentRoom.id}`
            },
            payload => {

                const el = document.querySelector(
                    `[data-message-id="${payload.new.id}"]`
                );

                if (!el) return;

                const bubble =
                    el.querySelector(".message-bubble");

                if (bubble) {
                    renderReactions(
                        bubble,
                        payload.new.reactions
                    );
                }

                const tick =
                    el.querySelector(".message-tick");

                const list =
                    payload.new.seen_by || [];

                if (tick && list.length) {

                    tick.textContent =
                        "✓✓ Seen by " + list.join(", ");

                    tick.classList.add("seen");
                }
            }
        )

        // ROOM UPDATE
        .on(
            "broadcast",
            {
                event: "roomupdate"
            },
            payload => {

                if (!currentRoom) return;

                currentRoom.room_name =
                    payload.payload?.name || null;

                if (payload.payload?.avatar) {
                    currentRoom.room_avatar =
                        payload.payload.avatar;
                }

                applyRoomHeader();
            }
        )

        // TYPING
        .on(
            "broadcast",
            {
                event: "typing"
            },
            payload => {

                if (payload.payload?.user) {
                    showTyping(
                        payload.payload.user
                    );
                }
            }
        )

        .subscribe();
}


// ======================================================
// DISPLAY MESSAGE
// ======================================================

function displayMessage(message) {

    const container = $("messages");

    if (!container || !message) return;

    // Avoid duplicate messages
    if (
        message.id &&
        document.querySelector(
            `[data-message-id="${message.id}"]`
        )
    ) {
        return;
    }

    const wrapper =
        document.createElement("div");

    wrapper.className = "message";

    if (message.username === currentUser) {
        wrapper.classList.add("mine");
    }

    const bubble =
        document.createElement("div");

    bubble.className = "message-bubble";


    // ==================================================
    // USERNAME
    // ==================================================

    const name =
        document.createElement("div");

    name.className = "message-name";

    name.textContent =
        message.username === currentUser
            ? "You"
            : message.username;

    name.style.fontSize = "12px";
    name.style.fontWeight = "600";
    name.style.opacity = "0.8";
    name.style.marginBottom = "2px";

    bubble.appendChild(name);


    // ==================================================
    // REPLY QUOTE
    // ==================================================

    if (message.reply_to) {

        const quote =
            document.createElement("div");

        quote.className = "reply-quote";

        quote.innerHTML =
            "<strong></strong><span></span>";

        quote.querySelector("strong").textContent =
            message.reply_to.name || "";

        quote.querySelector("span").textContent =
            message.reply_to.text || "";

        quote.addEventListener("click", () => {

            const target =
                document.querySelector(
                    `[data-message-id="${message.reply_to.id}"]`
                );

            if (target) {
                target.scrollIntoView({
                    behavior: "smooth",
                    block: "center"
                });
            }
        });

        bubble.appendChild(quote);
    }


    // ==================================================
    // CONTENT
    // ==================================================

    let content = null;


    // ---------- STICKER ----------

    if (
        message.media_url &&
        message.media_type === "sticker"
    ) {

        content =
            document.createElement("img");

        content.src = message.media_url;

        content.className =
            "message-sticker";

        content.alt = "Sticker";

        content.style.maxWidth = "160px";
        content.style.maxHeight = "160px";
        content.style.width = "auto";
        content.style.height = "auto";
        content.style.objectFit = "contain";
        content.style.display = "block";
    }


    // ---------- VIDEO ----------

    else if (
        message.media_url &&
        message.media_type === "video"
    ) {

        content =
            document.createElement("video");

        content.controls = true;
        content.preload = "metadata";
        content.src = message.media_url;
        content.className = "message-media";
    }


    // ---------- IMAGE ----------

    else if (message.media_url) {

        content =
            document.createElement("img");

        content.src = message.media_url;

        content.className =
            "message-media";

        content.alt = "Image";

        content.loading = "lazy";
    }


    // ---------- VOICE ----------

    else if (message.audio_url) {

        content =
            document.createElement("audio");

        content.controls = true;

        content.preload = "metadata";

        content.src = message.audio_url;

        content.style.maxWidth = "200px";
    }


    // ---------- TEXT ----------

    else {

        content =
            document.createElement("div");

        content.className =
            "message-text";

        content.textContent =
            message.message || "";
    }


    if (content) {
        bubble.appendChild(content);
    }


    // ==================================================
    // TIME
    // ==================================================

    const time =
        document.createElement("span");

    time.className =
        "message-time";

    time.textContent =
        formatTime(message.created_at);

    bubble.appendChild(time);


    // ==================================================
    // SEEN TICK
    // ==================================================

    if (message.username === currentUser) {

        const tick =
            document.createElement("div");

        const seenList =
            message.seen_by || [];

        tick.className =
            "message-tick" +
            (seenList.length ? " seen" : "");

        tick.textContent =
            seenList.length
                ? "✓✓ Seen by " + seenList.join(", ")
                : "✓";

        bubble.appendChild(tick);
    }


    // ==================================================
    // REACTIONS
    // ==================================================

    renderReactions(
        bubble,
        message.reactions
    );


    // ==================================================
    // APPEND
    // ==================================================

    if (message.id) {
        wrapper.dataset.messageId =
            message.id;
    }

    wrapper.appendChild(bubble);

    attachLongPress(
        wrapper,
        message,
        wrapper
    );

    attachSwipeReply(
        wrapper,
        message
    );

    container.appendChild(wrapper);

    container.scrollTop =
        container.scrollHeight;
}


// ======================================================
// HELPERS
// ======================================================

function formatTime(date) {

    if (!date) return "";

    return new Date(date).toLocaleTimeString(
        [],
        {
            hour: "2-digit",
            minute: "2-digit"
        }
    );
}


function generateRoomCode() {

    const characters =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let code = "";

    for (let i = 0; i < 6; i++) {

        code +=
            characters[
                Math.floor(
                    Math.random() *
                    characters.length
                )
            ];
    }

    return code;
}


function scrollMessages() {

    const container = $("messages");

    if (!container) return;

    container.scrollTop =
        container.scrollHeight;
}


// ======================================================
// LEAVE
// ======================================================

if ($("leaveBtn")) {

    $("leaveBtn").addEventListener(
        "click",
        async () => {

            if (realtimeChannel) {

                await supabaseClient
                    .removeChannel(
                        realtimeChannel
                    );

                realtimeChannel = null;
            }

            currentRoom = null;
            currentUser = null;

            if ($("messages")) {
                $("messages").innerHTML = "";
            }

            showPage("homePage");
        }
    );
}


// ======================================================
// VOICE RECORDING
// ======================================================

const voiceRecordBtn =
    $("voiceRecordBtn");

let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

const originalMicHTML =
    voiceRecordBtn
        ? voiceRecordBtn.innerHTML
        : "";


if (voiceRecordBtn) {

    voiceRecordBtn.addEventListener(
        "click",
        async () => {

            if (!isRecording) {

                try {

                    const stream =
                        await navigator.mediaDevices.getUserMedia({
                            audio: {
                                echoCancellation: true,
                                noiseSuppression: true,
                                autoGainControl: true,
                                channelCount: 1
                            }
                        });

                    const options =
                        MediaRecorder.isTypeSupported(
                            "audio/webm;codecs=opus"
                        )
                            ? {
                                mimeType:
                                    "audio/webm;codecs=opus",
                                audioBitsPerSecond:
                                    32000
                            }
                            : {};

                    mediaRecorder =
                        new MediaRecorder(
                            stream,
                            options
                        );

                    audioChunks = [];

                    mediaRecorder.ondataavailable =
                        event => {

                            if (event.data.size > 0) {
                                audioChunks.push(
                                    event.data
                                );
                            }
                        };


                    mediaRecorder.onstop =
                        async () => {

                            stream
                                .getTracks()
                                .forEach(track =>
                                    track.stop()
                                );

                            if (!currentRoom) {
                                stopRecordTimer();
                                return;
                            }

                            const audioBlob =
                                new Blob(
                                    audioChunks,
                                    {
                                        type:
                                            "audio/webm"
                                    }
                                );

                            const pending =
                                document.createElement("div");

                            pending.className =
                                "message mine";
                          pending.innerHTML =
                '<div class="message-bubble">' +
                '<div class="message-text">' +
                'Sending...' +
                '</div></div>';


            $("messages")?.appendChild(
                pending
            );


            scrollMessages();


            let body = file;
            let ext = "mp4";
            let type = file.type;


            if (!isVideo) {

                body =
                    await compressImage(
                        file
                    );

                ext = "jpg";

                type =
                    "image/jpeg";

            } else if (
                file.name.includes(".")
            ) {

                ext =
                    file.name
                        .split(".")
                        .pop();
            }


            const path =
                currentRoom.id +
                "/" +
                crypto.randomUUID() +
                "." +
                ext;


            const {
                error: upErr
            } =
                await supabaseClient
                    .storage
                    .from("media")
                    .upload(
                        path,
                        body,
                        {
                            contentType:
                                type
                        }
                    );


            if (upErr) {

                console.error(
                    upErr
                );

                pending.remove();

                alert(
                    "Upload failed."
                );

                return;
            }


            const url =
                supabaseClient
                    .storage
                    .from("media")
                    .getPublicUrl(
                        path
                    )
                    .data
                    .publicUrl;


            const {
                error
            } =
                await supabaseClient
                    .from("messages")
                    .insert({
                        room_id:
                            currentRoom.id,

                        username:
                            currentUser,

                        message:
                            "",

                        media_url:
                            url,

                        media_type:
                            isVideo
                                ? "video"
                                : "image",

                        reply_to:
                            replyingTo
                    });


            pending.remove();

            clearReply();


            if (error) {

                console.error(
                    error
                );

                alert(
                    "Could not send."
                );
            }
        }
    );
}

// ======================================================
// STICKERS + CUTOUT
// ======================================================

const stickerBtn =
    $("stickerBtn");

const stickerPanel =
    $("stickerPanel");

const closeStickerPanel =
    $("closeStickerPanel");

const openCutoutBtn =
    $("openCutoutBtn");

const cutoutEditor =
    $("cutoutEditor");

const cancelCutoutBtn =
    $("cancelCutoutBtn");

const saveCutoutBtn =
    $("saveCutoutBtn");

const cutoutCanvas =
    $("cutoutCanvas");

const cutoutBrushSize =
    $("cutoutBrushSize");

const eraseCutoutBtn =
    $("eraseCutoutBtn");

const restoreCutoutBtn =
    $("restoreCutoutBtn");

const resetCutoutBtn =
    $("resetCutoutBtn");

const stickerGrid =
    $("stickerGrid");

const emptyStickerMessage =
    $("emptyStickerMessage");


let stickers = [];


try {

    stickers =
        JSON.parse(
            localStorage.getItem(
                "privateRoomStickers"
            ) || "[]"
        );

    if (!Array.isArray(stickers)) {
        stickers = [];
    }

} catch (error) {

    console.error(
        "Sticker storage error:",
        error
    );

    stickers = [];
}


let currentStickerTab =
    "recent";


let cutoutImage = null;

let originalCanvasData = null;

let cutoutDrawing = false;

let cutoutMode = "erase";


// ======================================================
// OPEN STICKERS
// ======================================================

if (
    stickerBtn &&
    stickerPanel
) {

    stickerBtn.addEventListener(
        "click",
        event => {

            event.stopPropagation();

            stickerPanel.classList.toggle(
                "hidden"
            );


            if (
                !stickerPanel.classList.contains(
                    "hidden"
                )
            ) {

                renderStickerPanel();
            }
        }
    );
}


// ======================================================
// CLOSE STICKERS
// ======================================================

// IMPORTANT:
// Ye guard isliye lagaya hai taake agar HTML mein
// closeStickerPanel missing bhi ho to JS crash na kare.

if (
    closeStickerPanel &&
    stickerPanel
) {

    closeStickerPanel.addEventListener(
        "click",
        event => {

            event.stopPropagation();

            stickerPanel.classList.add(
                "hidden"
            );
        }
    );
}


// ======================================================
// STICKER TABS
// ======================================================

document
    .querySelectorAll(".sticker-tab")
    .forEach(tab => {

        tab.addEventListener(
            "click",
            () => {

                document
                    .querySelectorAll(
                        ".sticker-tab"
                    )
                    .forEach(t => {

                        t.classList.remove(
                            "active"
                        );
                    });


                tab.classList.add(
                    "active"
                );


                currentStickerTab =
                    tab.dataset.tab ||
                    "recent";


                renderStickerPanel();
            }
        );
    });


// ======================================================
// OPEN CUTOUT
// ======================================================

if (openCutoutBtn) {

    openCutoutBtn.addEventListener(
        "click",
        () => {

            openCutoutFilePicker();

            if (stickerPanel) {
                stickerPanel.classList.add("hidden");
            }
        }
    );
    }
                
                                 
  // ======================================================
// FILE PICKER
// ======================================================

function openCutoutFilePicker() {

    const input =
        document.createElement(
            "input"
        );

    input.type = "file";
    input.accept = "image/*";
    input.style.display = "none";
    document.body.appendChild(input);


    input.addEventListener(
        "change",
        () => {

            const file =
                input.files[0];

            if (!file) return;


            const reader =
                new FileReader();


            reader.onload = () => {

                loadCutoutImage(
                    reader.result
                );
            };


            reader.readAsDataURL(
                file
            );
        }
    );


    input.click();
}


// ======================================================
// LOAD CUTOUT IMAGE
// ======================================================

function loadCutoutImage(src) {

    if (!cutoutCanvas) return;


    const img =
        new Image();


    img.onload = () => {

        cutoutImage =
            img;


        const maxSize =
            700;


        let width =
            img.width;

        let height =
            img.height;


        if (
            width > maxSize ||
            height > maxSize
        ) {

            const scale =
                Math.min(
                    maxSize / width,
                    maxSize / height
                );


            width *= scale;
            height *= scale;
        }


        width =
            Math.round(width);

        height =
            Math.round(height);


        cutoutCanvas.width =
            width;

        cutoutCanvas.height =
            height;


        const ctx =
            cutoutCanvas.getContext(
                "2d"
            );


        ctx.clearRect(
            0,
            0,
            width,
            height
        );


        ctx.drawImage(
            img,
            0,
            0,
            width,
            height
        );


        originalCanvasData =
            ctx.getImageData(
                0,
                0,
                width,
                height
            );


        cutoutMode =
            "erase";


        if (eraseCutoutBtn) {
            eraseCutoutBtn.classList.add(
                "active"
            );
        }


        if (restoreCutoutBtn) {
            restoreCutoutBtn.classList.remove(
                "active"
            );
        }


        if (cutoutEditor) {

            cutoutEditor.classList.remove(
                "hidden"
            );
        }
    };


    img.onerror = () => {

        alert(
            "Image load nahi ho saki."
        );
    };


    img.src = src;
}


// ======================================================
// CANVAS POSITION
// ======================================================

function getCanvasPosition(event) {

    if (!cutoutCanvas) {
        return {
            x: 0,
            y: 0
        };
    }


    const rect =
        cutoutCanvas.getBoundingClientRect();


    let clientX;
    let clientY;


    if (
        event.touches &&
        event.touches.length
    ) {

        clientX =
            event.touches[0].clientX;

        clientY =
            event.touches[0].clientY;

    } else {

        clientX =
            event.clientX;

        clientY =
            event.clientY;
    }


    return {

        x:
            (clientX - rect.left) *
            (
                cutoutCanvas.width /
                rect.width
            ),

        y:
            (clientY - rect.top) *
            (
                cutoutCanvas.height /
                rect.height
            )
    };
}

                    

                    // ======================================================
// CUTOUT DRAWING
// ======================================================

function eraseAtPosition(event) {

    if (
        !cutoutDrawing ||
        !cutoutCanvas
    ) {
        return;
    }


    event.preventDefault();


    const pos =
        getCanvasPosition(
            event
        );


    const ctx =
        cutoutCanvas.getContext(
            "2d"
        );


    const size =
        Number(
            cutoutBrushSize?.value ||
            40
        );


    if (
        cutoutMode ===
        "erase"
    ) {

        ctx.save();

        ctx.globalCompositeOperation =
            "destination-out";


        ctx.beginPath();


        ctx.arc(
            pos.x,
            pos.y,
            size / 2,
            0,
            Math.PI * 2
        );


        ctx.fill();

        ctx.restore();

    } else {

        // Restore original image only
        // inside the brush circle.

        const half =
            size / 2;


        ctx.save();


        ctx.beginPath();


        ctx.arc(
            pos.x,
            pos.y,
            half,
            0,
            Math.PI * 2
        );


        ctx.clip();


        ctx.drawImage(
            cutoutImage,
            0,
            0,
            cutoutCanvas.width,
            cutoutCanvas.height
        );


        ctx.restore();
    }
}

// ======================================================
// CANVAS EVENTS
// ======================================================

if (cutoutCanvas) {

    cutoutCanvas.addEventListener(
        "mousedown",
        event => {

            cutoutDrawing = true;

            eraseAtPosition(
                event
            );
        }
    );


    cutoutCanvas.addEventListener(
        "mousemove",
        eraseAtPosition
    );


    cutoutCanvas.addEventListener(
        "mouseup",
        () => {

            cutoutDrawing = false;
        }
    );


    cutoutCanvas.addEventListener(
        "mouseleave",
        () => {

            cutoutDrawing = false;
        }
    );


    cutoutCanvas.addEventListener(
        "touchstart",
        event => {

            cutoutDrawing = true;

            eraseAtPosition(
                event
            );

        },
        {
            passive: false
        }
    );


    cutoutCanvas.addEventListener(
        "touchmove",
        eraseAtPosition,
        {
            passive: false
        }
    );


    cutoutCanvas.addEventListener(
        "touchend",
        () => {

            cutoutDrawing = false;
        }
    );


    cutoutCanvas.addEventListener(
        "touchcancel",
        () => {

            cutoutDrawing = false;
        }
    );
}


// ======================================================
// ERASE
// ======================================================

if (eraseCutoutBtn) {

    eraseCutoutBtn.addEventListener(
        "click",
        () => {

            cutoutMode =
                "erase";


            eraseCutoutBtn.classList.add(
                "active"
            );


            restoreCutoutBtn?.classList.remove(
                "active"
            );
        }
    );
}

            // ======================================================
// RESTORE
// ======================================================

if (restoreCutoutBtn) {

    restoreCutoutBtn.addEventListener(
        "click",
        () => {

            cutoutMode =
                "restore";


            restoreCutoutBtn.classList.add(
                "active"
            );


            eraseCutoutBtn?.classList.remove(
                "active"
            );
        }
    );
}


// ======================================================
// RESET
// ======================================================

if (resetCutoutBtn) {

    resetCutoutBtn.addEventListener(
        "click",
        () => {

            if (
                !originalCanvasData ||
                !cutoutCanvas
            ) {
                return;
            }


            const ctx =
                cutoutCanvas.getContext(
                    "2d"
                );


            ctx.putImageData(
                originalCanvasData,
                0,
                0
            );
        }
    );
}


// ======================================================
// CANCEL CUTOUT
// ======================================================

if (cancelCutoutBtn) {

    cancelCutoutBtn.addEventListener(
        "click",
        () => {

            cutoutImage = null;

            originalCanvasData = null;

            cutoutDrawing = false;


            if (cutoutCanvas) {

                const ctx =
                    cutoutCanvas.getContext(
                        "2d"
                    );


                ctx.clearRect(
                    0,
                    0,
                    cutoutCanvas.width,
                    cutoutCanvas.height
                );
            }


            if (cutoutEditor) {

                cutoutEditor.classList.add(
                    "hidden"
                );
            }
        }
    );
}


// ======================================================
// SAVE STICKER
// ======================================================

if (saveCutoutBtn) {

    saveCutoutBtn.addEventListener(
        "click",
        () => {

            if (
                !cutoutImage ||
                !cutoutCanvas
            ) {
                return;
            }


            const stickerData =
                cutoutCanvas.toDataURL(
                    "image/png"
                );


            const sticker = {

                id:
                    crypto.randomUUID(),

                image:
                    stickerData,

                createdAt:
                    Date.now(),

                favorite:
                    false
            };


            stickers.unshift(
                sticker
            );


            localStorage.setItem(
                "privateRoomStickers",
                JSON.stringify(
                    stickers
                )
            );


            if (cutoutEditor) {

                cutoutEditor.classList.add(
                    "hidden"
                );
            }


            cutoutImage = null;

            originalCanvasData = null;


            renderStickerPanel();


            if (stickerPanel) {

                stickerPanel.classList.remove(
                    "hidden"
                );
            }
        }
    );
}


// ======================================================
// RENDER STICKERS
// ======================================================

function renderStickerPanel() {

    if (!stickerGrid) return;


    stickerGrid.innerHTML = "";


    let visibleStickers = [];


    if (
        currentStickerTab ===
        "favorites"
    ) {

        visibleStickers =
            stickers.filter(
                sticker =>
                    sticker.favorite
            );

    } else {

        visibleStickers =
            [...stickers];
    }


    if (!visibleStickers.length) {

        emptyStickerMessage?.classList.remove(
            "hidden"
        );

        return;
    }


    emptyStickerMessage?.classList.add(
        "hidden"
    );


    visibleStickers.forEach(
        sticker => {

            const wrapper =
                document.createElement(
                    "div"
                );


            wrapper.className =
                "sticker-item";


            const img =
                document.createElement(
                    "img"
                );


            img.src =
                sticker.image;

            img.alt =
                "Sticker";


            img.addEventListener(
                "click",
                () => {

                    sendSticker(
                        sticker
                    );
                }
            );


            wrapper.appendChild(
                img
            );


            // FAVORITE BUTTON

            const fav =
                document.createElement(
                    "button"
                );


            fav.type =
                "button";


            fav.className =
                "sticker-favorite";


            fav.textContent =
                sticker.favorite
                    ? "★"
                    : "☆";


            fav.addEventListener(
                "click",
                event => {

                    event.stopPropagation();


                    sticker.favorite =
                        !sticker.favorite;


                    localStorage.setItem(
                        "privateRoomStickers",
                        JSON.stringify(
                            stickers
                        )
                    );


                    renderStickerPanel();
                }
            );


            wrapper.appendChild(
                fav
            );


            stickerGrid.appendChild(
                wrapper
            );
        }
    );
}

async function sendSticker(sticker) {
    if (!currentRoom) return;

    if (stickerPanel) stickerPanel.classList.add("hidden");

    const blob = await (await fetch(sticker.image)).blob();
    const path = currentRoom.id + "/" + crypto.randomUUID() + ".png";

    const { error: upErr } = await supabaseClient
        .storage.from("media")
        .upload(path, blob, { contentType: "image/png" });

    if (upErr) {
        console.error(upErr);
        alert("Sticker upload failed.");
        return;
    }

    const url = supabaseClient.storage.from("media").getPublicUrl(path).data.publicUrl;

    const { error } = await supabaseClient.from("messages").insert({
        room_id: currentRoom.id,
        username: currentUser,
        message: "",
        media_url: url,
        media_type: "sticker",
        reply_to: replyingTo
    });

    clearReply();

    if (error) {
        console.error(error);
        alert("Could not send sticker.");
    }
}

                                    
