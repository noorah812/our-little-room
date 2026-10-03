// ================================
// Private Chat - App
// ================================

const SUPABASE_URL = "https://fyxkmzkpoykroxsjjnzm.supabase.co";
const SUPABASE_KEY = "sb_publishable_djuZJaO1ZxDZOvMRW--5OQ_s_yCIOFo";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentRoom = null;
let currentUser = null;
let realtimeChannel = null;

// ---------- PAGES ----------
function showPage(pageId) {
    document.querySelectorAll(".page, .chat-page").forEach(page => {
        page.classList.add("hidden");
    });
    document.getElementById(pageId).classList.remove("hidden");
}

document.getElementById("createBtn").addEventListener("click", () => {
    showPage("createPage");
});

document.getElementById("showJoinBtn").addEventListener("click", () => {
    showPage("joinPage");
});

// ---------- CREATE ROOM ----------
document.getElementById("createRoomBtn").addEventListener("click", async () => {
    const password = document.getElementById("createPassword").value.trim();

    if (!password) {
        alert("Password enter karo.");
        return;
    }

    const roomCode = generateRoomCode();

    const { data, error } = await supabaseClient
        .rpc("create_room", { p_code: roomCode, p_password: password })
        .single();

    if (error) {
        console.error(error);
        alert("ERROR: " + error.message);
        return;
    }

    currentRoom = data;
    document.getElementById("newRoomCode").textContent = roomCode;
    document.getElementById("createdRoom").classList.remove("hidden");
});

// ---------- ENTER CREATED ROOM ----------
document.getElementById("enterCreatedRoom").addEventListener("click", () => {
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

// ---------- JOIN ROOM ----------
document.getElementById("joinRoomBtn").addEventListener("click", async () => {
    const roomCode = document.getElementById("roomCode").value.trim().toUpperCase();
    const password = document.getElementById("joinPassword").value.trim();
    const username = document.getElementById("username").value.trim();

    if (!roomCode || !password || !username) {
        alert("Sab fields fill karo.");
        return;
    }

    const { data, error } = await supabaseClient
        .rpc("join_room", { p_code: roomCode, p_password: password })
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

// ---------- OPEN CHAT ----------
async function openChat() {
    showPage("chatPage");
    document.getElementById("roomLabel").textContent = `Room: ${currentRoom.room_code}`;

    await loadMessages();
    markSeen();
    subscribeToMessages();
}

// ---------- LOAD MESSAGES ----------
async function loadMessages() {
    const { data, error } = await supabaseClient
        .from("messages")
        .select("*")
        .eq("room_id", currentRoom.id)
        .order("created_at", { ascending: true });

    if (error) {
        console.error(error);
        return;
    }

    document.getElementById("messages").innerHTML = "";
    data.forEach(message => displayMessage(message));
    scrollMessages();
}

// ---------- SEND MESSAGE ----------
document.getElementById("messageForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    const input = document.getElementById("messageInput");
    const text = input.value.trim();
    if (!text) return;

    const { error } = await supabaseClient.from("messages").insert({
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

// ---------- REALTIME ----------
function subscribeToMessages() {
    if (realtimeChannel) {
        supabaseClient.removeChannel(realtimeChannel);
    }

    realtimeChannel = supabaseClient
        .channel(`room-${currentRoom.id}`, {
            config: { broadcast: { self: false } }
        })
        .on(
            "postgres_changes",
            {
                event: "INSERT",
                schema: "public",
                table: "messages",
                filter: `room_id=eq.${currentRoom.id}`
            },
            payload => {
                displayMessage(payload.new);
                scrollMessages();
                if (payload.new.username !== currentUser) markSeen();
            }
        )
        .on(
            "postgres_changes",
            { event: "DELETE", schema: "public", table: "messages" },
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
                if (!el) return;

                renderReactions(
                    el.querySelector(".message-bubble"),
                    payload.new.reactions
                );

                const tick = el.querySelector(".message-tick");
                const list = payload.new.seen_by || [];
                if (tick && list.length) {
                    tick.textContent = "✓✓ Seen by " + list.join(", ");
                    tick.classList.add("seen");
                }
            }
        )
        .on("broadcast", { event: "typing" }, payload => {
            showTyping(payload.payload.user);
        })
        .subscribe();
}

// ---------- DISPLAY MESSAGE ----------
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
    name.textContent = message.username === currentUser ? "You" : message.username;
    name.style.fontSize = "12px";
    name.style.fontWeight = "600";
    name.style.opacity = "0.8";
    name.style.marginBottom = "2px";

    bubble.appendChild(name);

    if (message.reply_to) {
        const quote = document.createElement("div");
        quote.className = "reply-quote";
        quote.innerHTML = "<strong></strong><span></span>";
        quote.querySelector("strong").textContent = message.reply_to.name;
        quote.querySelector("span").textContent = message.reply_to.text;
        quote.addEventListener("click", () => {
            const target = document.querySelector(
                `[data-message-id="${message.reply_to.id}"]`
            );
            if (target) {
                target.scrollIntoView({ behavior: "smooth", block: "center" });
            }
        });
        bubble.appendChild(quote);
    }
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

    renderReactions(bubble, message.reactions);

    wrapper.dataset.messageId = message.id;
    wrapper.appendChild(bubble);
    attachLongPress(wrapper, message, wrapper);
    attachSwipeReply(wrapper, message);

    container.appendChild(wrapper);
    container.scrollTop = container.scrollHeight;
}

// ---------- HELPERS ----------
function formatTime(date) {
    return new Date(date).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    });
}

function generateRoomCode() {
    const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i++) {
        code += characters[Math.floor(Math.random() * characters.length)];
    }
    return code;
}

function scrollMessages() {
    const container = document.getElementById("messages");
    container.scrollTop = container.scrollHeight;
}

// ---------- LEAVE ----------
document.getElementById("leaveBtn").addEventListener("click", async () => {
    if (realtimeChannel) {
        await supabaseClient.removeChannel(realtimeChannel);
        realtimeChannel = null;
    }

    currentRoom = null;
    currentUser = null;
    document.getElementById("messages").innerHTML = "";
    showPage("homePage");
});

// ---------- VOICE ----------
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
                stream.getTracks().forEach(track => track.stop());

                const audioBlob = new Blob(audioChunks, { type: "audio/webm" });

                const pending = document.createElement("div");
                pending.className = "message mine";
                pending.innerHTML =
                    '<div class="message-bubble"><div class="message-text">🎤 Sending voice...</div></div>';
                document.getElementById("messages").appendChild(pending);
                scrollMessages();

                const fileName = currentRoom.id + "/" + crypto.randomUUID() + ".webm";

                const { error: uploadError } = await supabaseClient
                    .storage
                    .from("voice")
                    .upload(fileName, audioBlob, { contentType: "audio/webm" });

                if (uploadError) {
                    console.error(uploadError);
                    pending.remove();
                    alert("Voice upload failed.");
                    return;
                }

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

                pending.remove();

                if (insertError) {
                    console.error(insertError);
                    alert("Voice message could not be sent.");
                }
            };

            mediaRecorder.start();

            isRecording = true;
            voiceRecordBtn.innerHTML = '<span class="stop-square"></span>';
            voiceRecordBtn.classList.add("recording");
            voiceRecordBtn.title = "Stop recording";
            startRecordTimer();
        } catch (error) {
            console.error("Microphone error:", error);
            alert("Microphone permission is required.");
        }
    } else {
        mediaRecorder.stop();

        isRecording = false;
        voiceRecordBtn.innerHTML = originalMicHTML;
        voiceRecordBtn.classList.remove("recording");
        voiceRecordBtn.title = "Record voice";
        stopRecordTimer();
    }
});

// ---------- SAVED NAME ----------
const savedName = localStorage.getItem("chatUsername");
if (savedName) {
    document.getElementById("username").value = savedName;
}

// ---------- SEEN ----------
async function markSeen() {
    if (!currentRoom || !currentUser || document.hidden) return;

    await supabaseClient.rpc("mark_seen", {
        p_room: String(currentRoom.id),
        p_user: currentUser
    });
}

document.addEventListener("visibilitychange", markSeen);

// ---------- REACTIONS + MENU ----------
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

function attachLongPress(target, message, wrapper) {
    let timer;
    const start = () => {
        timer = setTimeout(() => openMessageMenu(message, wrapper), 600);
    };
    const cancel = () => clearTimeout(timer);

    target.addEventListener("touchstart", start, { passive: true });
    target.addEventListener("touchend", cancel);
    target.addEventListener("touchmove", cancel);
    target.addEventListener("mousedown", start);
    target.addEventListener("mouseup", cancel);
    target.addEventListener("mouseleave", cancel);
    target.addEventListener("contextmenu", e => e.preventDefault());
}

// ---------- TYPING ----------
const typingUsers = {};

function showTyping(user) {
    clearTimeout(typingUsers[user]);
    typingUsers[user] = setTimeout(() => {
        delete typingUsers[user];
        updateTyping();
    }, 3000);
    updateTyping();
}

function updateTyping() {
    const el = document.getElementById("typingIndicator");
    if (!el) return;

    const names = Object.keys(typingUsers);
    el.textContent = names.length
        ? names.join(", ") + (names.length > 1 ? " are" : " is") + " typing..."
        : "";
}

let lastTypingSent = 0;

document.getElementById("messageInput").addEventListener("input", () => {
    if (!realtimeChannel || !currentUser) return;

    const now = Date.now();
    if (now - lastTypingSent < 1500) return;
    lastTypingSent = now;

    realtimeChannel.send({
        type: "broadcast",
        event: "typing",
        payload: { user: currentUser }
    });
});
// ---------- REPLY ----------
let replyingTo = null;

function startReply(message) {
    replyingTo = {
        id: message.id,
        name: message.username === currentUser ? "You" : message.username,
        text: message.audio_url ? "🎤 Voice message" : (message.message || "").slice(0, 80)
    };
    document.getElementById("replyBarName").textContent = replyingTo.name;
    document.getElementById("replyBarMsg").textContent = replyingTo.text;
    document.getElementById("replyBar").classList.remove("hidden");
    document.getElementById("messageInput").focus();
}

function clearReply() {
    replyingTo = null;
    document.getElementById("replyBar").classList.add("hidden");
}

document.getElementById("replyCancel").addEventListener("click", clearReply);

function attachSwipeReply(el, message) {
    let startX = 0;
    let startY = 0;
    let moved = false;

    el.addEventListener("touchstart", e => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        moved = false;
    }, { passive: true, capture: true });

    el.addEventListener("touchmove", e => {
        const dx = e.touches[0].clientX - startX;
        const dy = Math.abs(e.touches[0].clientY - startY);

        if (dy > 30) return;

        if (Math.abs(dx) > 10) {
            moved = true;
            const shift = Math.max(-60, Math.min(60, dx));
            el.style.transform = `translateX(${shift}px)`;
        }
    }, { passive: true, capture: true });

    el.addEventListener("touchend", e => {
    
