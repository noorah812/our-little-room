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


// ================================
// PAGE SYSTEM
// ================================

function showPage(pageId) {
    document
        .querySelectorAll(".page, .chat-page")
        .forEach(page => {
            page.classList.add("hidden");
        });

    document
        .getElementById(pageId)
        .classList.remove("hidden");
}


// ================================
// HOME BUTTONS
// ================================

document
    .getElementById("createBtn")
    .addEventListener("click", () => {
        showPage("createPage");
    });


document
    .getElementById("showJoinBtn")
    .addEventListener("click", () => {
        showPage("joinPage");
    });


// ================================
// CREATE ROOM
// ================================

document
    .getElementById("createRoomBtn")
    .addEventListener("click", async () => {

        const password =
            document
                .getElementById("createPassword")
                .value
                .trim();

        if (!password) {
            alert("Password enter karo.");
            return;
        }

        const roomCode = generateRoomCode();

        const { data, error } =
    await supabaseClient
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

        document
            .getElementById("newRoomCode")
            .textContent = roomCode;

        document
            .getElementById("createdRoom")
            .classList.remove("hidden");
    });


// ================================
// ENTER CREATED ROOM
// ================================

document
    .getElementById("enterCreatedRoom")
    .addEventListener("click", () => {

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


// ================================
// JOIN ROOM
// ================================

document
    .getElementById("joinRoomBtn")
    .addEventListener("click", async () => {

        const roomCode =
            document
                .getElementById("roomCode")
                .value
                .trim()
                .toUpperCase();

        const password =
            document
                .getElementById("joinPassword")
                .value
                .trim();

        const username =
            document
                .getElementById("username")
                .value
                .trim();

        if (!roomCode || !password || !username) {
            alert("Sab fields fill karo.");
            return;
        }

        const { data, error } =
    await supabaseClient
        .rpc("join_room", {
            p_code: roomCode,
            p_password: password
        })
        .maybeSingle();

        if (error || !data) {
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


// ================================
// OPEN CHAT
// ================================

async function openChat() {

    showPage("chatPage");

    document
        .getElementById("roomLabel")
        .textContent =
        `Room: ${currentRoom.room_code}`;

    await loadMessages();
markSeen();

    subscribeToMessages();
}


// ================================
// LOAD OLD MESSAGES
// ================================

async function loadMessages() {

    const { data, error } =
        await supabaseClient
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

    const container =
        document.getElementById("messages");

    container.innerHTML = "";

    data.forEach(message => {
        displayMessage(message);
    });

    scrollMessages();
}


// ================================
// SEND MESSAGE
// ================================

document
    .getElementById("messageForm")
    .addEventListener("submit", async (event) => {

        event.preventDefault();

        const input =
            document.getElementById("messageInput");

        const text = input.value.trim();
        if (!text) return;

        const { data, error } = await supabaseClient
  .from("messages")
  .insert({
    room_id: currentRoom.id,
    username: currentUser,
    message: text
  })
  .select()
  .single();

if (error) {
  console.error(error);
  alert("Message could not be sent.");
  return;
}
input.value = "";
});

// ================================
// REAL-TIME MESSAGES
// ================================

function subscribeToMessages() {

    if (realtimeChannel) {
        supabaseClient.removeChannel(
            realtimeChannel
        );
    }

    realtimeChannel =
        supabaseClient
            .channel(`room-${currentRoom.id}`)

            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "messages",
                    filter:
                        `room_id=eq.${currentRoom.id}`
                },

                payload => {
                    displayMessage(payload.new);
scrollMessages();
if (payload.new.username !== currentUser) markSeen();
                }
            )

            
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
                if (el) el.remove();
            }
        )

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
                const tick = el && el.querySelector(".message-tick");
                const list = payload.new.seen_by || [];
                if (el) renderReactions(el.querySelector(".message-bubble"), payload.new.reactions);
                if (tick && list.length) {
                    tick.textContent = "✓✓ Seen by " + list.join(", ");
                    tick.classList.add("seen");
                }
            }
        )

        .subscribe();
}


// ================================
// DISPLAY MESSAGE
// ================================

function displayMessage(message) {
    const container = document.getElementById("messages");

    const wrapper = document.createElement("div");
    wrapper.className = "message";

    if (message.username === currentUser) {
        wrapper.classList.add("mine");
    }

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";

    let text;
    if (message.audio_url) {
        text = document.createElement("audio");
        text.controls = true;
        text.style.pointerEvents = "auto";
        bubble.style.cursor = "pointer";
        text.src = message.audio_url;
        text.style.maxWidth = "200px";
    } else {
        text = document.createElement("div");
        text.className = "message-text";
        text.textContent = message.message;
    }

    const time = document.createElement("span");
    time.className = "message-time";
    time.textContent = formatTime(message.created_at);

    const name = document.createElement("div");
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
bubble.appendChild(text);
bubble.appendChild(time);
if (message.username === currentUser) {
    const tick = document.createElement("div");
    const seenList = message.seen_by || [];
    tick.className = "message-tick" + (seenList.length ? " seen" : "");
    tick.textContent = seenList.length
        ? "✓✓ Seen by " + seenList.join(", ")
        : "✓";
    bubble.appendChild(tick);
}


attachLongPress(bubble, message, wrapper);
renderReactions(bubble, message.reactions);
    wrapper.dataset.messageId = message.id;
wrapper.appendChild(bubble);
attachLongPress(bubble, message, wrapper);
    container.appendChild(wrapper);

    container.scrollTop = container.scrollHeight;
}


// ================================
// TIME
// ================================

function formatTime(date) {

    return new Date(date).toLocaleTimeString(
        [],
        {
            hour: "2-digit",
            minute: "2-digit"
        }
    );
}


// ================================
// ROOM CODE
// ================================

function generateRoomCode() {

    const characters =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let code = "";

    for (let i = 0; i < 6; i++) {

        code += characters[
            Math.floor(
                Math.random() *
                characters.length
            )
        ];
    }

    return code;
}


// ================================
// SCROLL
// ================================

function scrollMessages() {

    const container =
        document.getElementById("messages");

    container.scrollTop =
        container.scrollHeight;
}


// ================================
// LEAVE ROOM
// ================================

document
    .getElementById("leaveBtn")
    .addEventListener("click", async () => {

        if (realtimeChannel) {

            await supabaseClient
                .removeChannel(
                    realtimeChannel
                );

            realtimeChannel = null;
        }

        currentRoom = null;
        currentUser = null;

        document
            .getElementById("messages")
            .innerHTML = "";

        showPage("homePage");
    });
    // 🎙️ Voice Recording
const voiceRecordBtn = document.getElementById("voiceRecordBtn");

let mediaRecorder;
let audioChunks = [];
let isRecording = false;
const originalMicHTML = voiceRecordBtn.innerHTML;

voiceRecordBtn.addEventListener("click", async () => {
    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
    }
});

            const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 32000 }
    : {};
mediaRecorder = new MediaRecorder(stream, options);
            audioChunks = [];

            mediaRecorder.ondataavailable = (event) => {
                audioChunks.push(event.data);
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, {
                    type: "audio/webm"
                });
const pending = document.createElement("div");
pending.className = "message mine";
pending.innerHTML = '<div class="message-bubble"><div class="message-text">🎤 Sending voice...</div></div>';
document.getElementById("messages").appendChild(pending);
scrollMessages();
                const fileName = currentRoom.id + "/" + crypto.randomUUID() + ".webm";

const { error: uploadError } = await supabaseClient
    .storage
    .from("voice")
    .upload(fileName, audioBlob, { contentType: "audio/webm" });

if (uploadError) {
    console.error(uploadError);
    alert("Voice upload failed.");
} else {
    const { data: urlData } = supabaseClient
        .storage
        .from("voice")
        .getPublicUrl(fileName);

    const { error: insertError } = await supabaseClient
        .from("messages")
        .insert({
            room_id: currentRoom.id,
            username: currentUser,
            message: "",
            audio_url: urlData.publicUrl
        });

    if (insertError) {
        console.error(insertError);
        alert("Voice message could not be sent.");
    }
}
setTimeout(() => pending.remove(), 400);
                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorder.start();

            isRecording = true;
            voiceRecordBtn.textContent = "⏹️";
            voiceRecordBtn.title = "Stop recording";

        } catch (error) {
            console.error("Microphone error:", error);
            alert("Microphone permission is required.");
        }

    } else {
        mediaRecorder.stop();

        isRecording = false;
        voiceRecordBtn.innerHTML = originalMicHTML;
        voiceRecordBtn.title = "Record voice";
    }
});
const savedName = localStorage.getItem("chatUsername");
if (savedName) {
    document.getElementById("username").value = savedName;
}
async function markSeen() {
    if (!currentRoom || !currentUser || document.hidden) return;

    await supabaseClient.rpc("mark_seen", {
        p_room: String(currentRoom.id),
        p_user: currentUser
    });
}

document.addEventListener("visibilitychange", markSeen);
const REACTIONS = ["😭", "😂", "😢", "👍", "🙏"];

function renderReactions(bubble, reactions) {
    if (!bubble) return;
    let bar = bubble.querySelector(".reaction-bar");
    const entries = Object.entries(reactions || {});

    if (!entries.length) {
        if (bar) bar.remove();
        return;
    }
    if (!bar) {
        bar = document.createElement("div");
        bar.className = "reaction-bar";
        bubble.appendChild(bar);
    }

    const groups = {};
    entries.forEach(([user, emoji]) => {
        (groups[emoji] = groups[emoji] || []).push(user);
    });

    bar.innerHTML = "";
    Object.entries(groups).forEach(([emoji, users]) => {
        const chip = document.createElement("span");
        chip.className = "reaction-chip";
        chip.textContent = emoji + (users.length > 1 ? " " + users.length : "");
        chip.addEventListener("click", () => {
            alert(emoji + " by " + users.join(", "));
        });
        bar.appendChild(chip);
    });
}

async function sendReaction(messageId, emoji) {
    await supabaseClient.rpc("react_message", {
        p_id: String(messageId),
        p_user: currentUser,
        p_emoji: emoji
    });
}

function closeMessageMenu() {
    const old = document.querySelector(".message-menu");
    if (old) old.remove();
}

function openMessageMenu(message, wrapper) {
    closeMessageMenu();

    const menu = document.createElement("div");
    menu.className = "message-menu";

    REACTIONS.forEach(emoji => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = emoji;
        b.addEventListener("click", () => {
            sendReaction(message.id, emoji);
            closeMessageMenu();
        });
        menu.appendChild(b);
    });

    if (message.username === currentUser) {
        const del = document.createElement("button");
        del.type = "button";
        del.textContent = "🗑️";
        del.addEventListener("click", async () => {
            closeMessageMenu();
            if (!confirm("Delete this message?")) return;

            const { data, error } = await supabaseClient
                .from("messages")
                .delete()
                .eq("id", message.id)
                .select();

            if (error || !data || data.length === 0) {
                console.error(error);
                alert("Delete failed.");
                return;
            }
            wrapper.remove();
        });
        menu.appendChild(del);
    }

    document.body.appendChild(menu);

    const rect = wrapper.getBoundingClientRect();
    menu.style.top = Math.max(rect.top - 56, 80) + "px";

    const outside = (e) => {
        if (!menu.contains(e.target)) {
            closeMessageMenu();
            document.removeEventListener("pointerdown", outside);
        }
    };
    setTimeout(() => {
        document.addEventListener("pointerdown", outside);
    }, 300);
}

function attachLongPress(bubble, message, wrapper) {
    let timer;
    const start = () => {
        timer = setTimeout(() => openMessageMenu(message, wrapper), 600);
    };
    const cancel = () => clearTimeout(timer);

    bubble.addEventListener("touchstart", start, { passive: true });
    bubble.addEventListener("touchend", cancel);
    bubble.addEventListener("touchmove", cancel);
    bubble.addEventListener("mousedown", start);
    bubble.addEventListener("mouseup", cancel);
    bubble.addEventListener("mouseleave", cancel);
    bubble.addEventListener("contextmenu", e => e.preventDefault());
}
