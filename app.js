// ================================
// Private Chat - App
// ================================

const SUPABASE_URL = "https://fyxkmzkpoykroxsjjnzm.supabase.co";
const SUPABASE_KEY = "sb_publishable_djuZJaO1ZxDZOvMRW--5OQ_s_yCIOFo";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentRoom = null;
let currentUser = null;
let realtimeChannel = null;
let replyingTo = null;
const avatarCache = {};
async function loadAvatars(usernames) {
    const need = [...new Set(usernames)].filter(u => u && !(u in avatarCache));
    if (!need.length) return;
    const { data } = await supabaseClient
        .from("profiles")
        .select("username,display_name,avatar_url")
        .in("username", need);
    need.forEach(u => { avatarCache[u] = null; });
    (data || []).forEach(p => { avatarCache[p.username] = p; });
}

const $ = id => document.getElementById(id);

// ---------- PAGES ----------
function showPage(pageId) {
    document.querySelectorAll(".page, .chat-page").forEach(p => p.classList.add("hidden"));
    $(pageId).classList.remove("hidden");
}

$("createBtn").addEventListener("click", () => showPage("createPage"));
$("showJoinBtn").addEventListener("click", () => showPage("joinPage"));

// ---------- CREATE ROOM ----------
$("createRoomBtn").addEventListener("click", async () => {
    const password = $("createPassword").value.trim();
    if (!password) { alert("Please enter a password."); return; }

    const roomCode = generateRoomCode();
    const { data, error } = await supabaseClient
        .rpc("create_room", { p_code: roomCode, p_password: password })
        .single();

    if (error) { console.error(error); alert("ERROR: " + error.message); return; }

    currentRoom = data;
    if (typeof applyNewRoomType === "function") await applyNewRoomType(data);
    $("newRoomCode").textContent = roomCode;
    $("createdRoom").classList.remove("hidden");
});

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

// ---------- JOIN ROOM ----------
$("joinRoomBtn").addEventListener("click", async () => {
    const roomCode = $("roomCode").value.trim().toUpperCase();
    const password = $("joinPassword").value.trim();
    const username = $("username").value.trim();

    if (!roomCode || !password || !username) { alert("Please fill in all fields."); return; }

    const { data, error } = await supabaseClient
        .rpc("join_room", { p_code: roomCode, p_password: password })
        .maybeSingle();

    if (error || !data) { alert("Room not found."); return; }
    if (data.password !== password) { alert("Wrong password."); return; }

    currentRoom = data;
    currentUser = username;
    localStorage.setItem("chatUsername", username);
    openChat();
});

const savedName = localStorage.getItem("chatUsername");
if (savedName) $("username").value = savedName;

// ---------- OPEN CHAT ----------
async function openChat() {
    showPage("chatPage");
    applyRoomHeader();
    $("roomLabel").textContent = `Room: ${currentRoom.room_code}`;
    await loadMessages();
    markSeen();
    subscribeToMessages();
}

 async function loadMessages() {
    let clearedAt = null;
    if (typeof authUser !== "undefined" && authUser) {
        const { data: mem } = await supabaseClient
            .from("room_members")
            .select("cleared_at")
            .eq("room_id", currentRoom.id)
            .eq("user_id", authUser.id)
            .maybeSingle();
        clearedAt = mem && mem.cleared_at;
    }

    let q = supabaseClient
        .from("messages")
        .select("*")
        .eq("room_id", currentRoom.id)
        .order("created_at", { ascending: true });
    if (clearedAt) q = q.gt("created_at", clearedAt);
    const { data, error } = await q;
    if (error) { console.error(error); return; }

    $("messages").innerHTML = "";
    await loadAvatars((data || []).map(m => m.username));
    (data || []).forEach(m => displayMessage(m));
    scrollMessages();
}

// ---------- SEND TEXT ----------

$("messageForm").addEventListener("submit", async event => {
    event.preventDefault();
    if (!currentRoom) return;

    const input = $("messageInput");
    const text = input.value.trim();
    if (!text) return;

    const { error } = await supabaseClient.from("messages").insert({
        room_id: currentRoom.id,
        username: currentUser,
        message: text,
        reply_to: replyingTo
    });

    if (error) { console.error(error); alert("Message could not be sent."); return; }

    input.value = "";
    if (typeof exitTypingMode === "function") exitTypingMode();
    clearReply();
});

// ---------- REALTIME ----------
function subscribeToMessages() {
    if (!currentRoom) return;
    if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);

    realtimeChannel = supabaseClient
        .channel(`room-${currentRoom.id}`, { config: { broadcast: { self: false } } })
        .on("postgres_changes",
    { event: "INSERT", schema: "public", table: "messages", filter: `room_id=eq.${currentRoom.id}` },
    async payload => {
        if (!currentRoom) return;
        await loadAvatars([payload.new.username]);
        displayMessage(payload.new);
        scrollMessages();
        if (payload.new.username !== currentUser) markSeen();
    })
        .on("postgres_changes",
            { event: "DELETE", schema: "public", table: "messages" },
            payload => {
                const el = document.querySelector(`[data-message-id="${payload.old.id}"]`);
                if (el) el.remove();
            })
        .on("postgres_changes",
            { event: "UPDATE", schema: "public", table: "messages", filter: `room_id=eq.${currentRoom.id}` },
            payload => {
                const el = document.querySelector(`[data-message-id="${payload.new.id}"]`);
                if (!el) return;
                renderReactions(el.querySelector(".message-bubble"), payload.new.reactions);
                const tick = el.querySelector(".message-tick");
                const list = payload.new.seen_by || [];
                if (tick && list.length) {
                    tick.textContent = "✓✓ Seen by " + list.join(", ");
                    tick.classList.add("seen");
                }
            })
        .on("broadcast", { event: "roomupdate" }, payload => {
            if (!currentRoom) return;
            currentRoom.room_name = payload.payload.name;
            if (payload.payload.avatar) currentRoom.room_avatar = payload.payload.avatar;
            applyRoomHeader();
        })
        .on("broadcast", { event: "typing" }, payload => {
    showTyping(payload.payload.username);
})
        .subscribe();
}

// ---------- DISPLAY MESSAGE ----------
function displayMessage(message) {
    const container = $("messages");
    if (!container || !message) return;

    if (message.id && document.querySelector(`[data-message-id="${message.id}"]`)) return;

    const wrapper = document.createElement("div");
    wrapper.className = "message";
    if (message.username === currentUser) wrapper.classList.add("mine");

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";

    const name = document.createElement("div");
    name.className = "message-name";
    name.textContent = message.username === currentUser ? "You" : message.username;
    name.style.fontSize = "12px";
    name.style.fontWeight = "600";
    name.style.opacity = "0.8";
    name.style.marginBottom = "2px";
    if (message.username !== currentUser) {
    name.style.cursor = "pointer";
    name.addEventListener("click", e => { e.stopPropagation(); openUserProfile(message.username); });
}
    bubble.appendChild(name);

    if (message.reply_to) {
        const quote = document.createElement("div");
        quote.className = "reply-quote";
        quote.innerHTML = "<strong></strong><span></span>";
        quote.querySelector("strong").textContent = message.reply_to.name || "";
        quote.querySelector("span").textContent = message.reply_to.text || "";
        quote.addEventListener("click", () => {
            const target = document.querySelector(`[data-message-id="${message.reply_to.id}"]`);
            if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        bubble.appendChild(quote);
    }

    let content;
  if (message.media_url && message.media_type === "video") {
    content = document.createElement("div");
    content.className = "media-wrap";
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.playsInline = true;
    v.src = message.media_url + "#t=0.1";
    v.className = "message-media";
    const badge = document.createElement("span");
    badge.className = "play-badge";
    content.append(v, badge);
    content.addEventListener("click", e => { e.stopPropagation(); openMediaViewer(message.media_url, "video"); });
} else if (message.media_url) {
    content = document.createElement("img");
    content.src = message.media_url;
    content.className = "message-media";
    content.alt = "Image";
    content.addEventListener("click", e => { e.stopPropagation(); openMediaViewer(message.media_url, "image"); });
    } else if (message.audio_url) {
        content = document.createElement("audio");
        content.controls = true;
        content.preload = "metadata";
        content.src = message.audio_url;
        content.style.maxWidth = "200px";
    } else {
        content = document.createElement("div");
        content.className = "message-text";
        content.textContent = message.message || "";
    }
    bubble.appendChild(content);

    const time = document.createElement("span");
    time.className = "message-time";
    time.textContent = formatTime(message.created_at);
    bubble.appendChild(time);

    if (message.username === currentUser) {
        const tick = document.createElement("div");
        const seenList = message.seen_by || [];
        tick.className = "message-tick" + (seenList.length ? " seen" : "");
        tick.textContent = seenList.length ? "✓✓ Seen by " + seenList.join(", ") : "✓";
        bubble.appendChild(tick);
    }

    renderReactions(bubble, message.reactions);

    if (message.id) wrapper.dataset.messageId = message.id;
   const p = avatarCache[message.username];
const av = document.createElement("div");
av.className = "msg-avatar";
av.addEventListener("click", e => { e.stopPropagation(); openUserProfile(message.username); });
if (p && p.avatar_url) av.style.backgroundImage = `url("${p.avatar_url}")`;
else av.textContent = ((p && p.display_name) || message.username || "?").charAt(0).toUpperCase();
if (message.username === currentUser) {
    wrapper.appendChild(bubble);
    wrapper.appendChild(av);
} else {
    wrapper.appendChild(av);
    wrapper.appendChild(bubble);
}
    attachLongPress(wrapper, message, wrapper);
    attachSwipeReply(wrapper, message);
    attachDoubleTap(wrapper, message);

    container.appendChild(wrapper);
    if (typingUsers[message.username]) {
    clearTimeout(typingUsers[message.username]);
    delete typingUsers[message.username];
}
updateTyping();
    container.scrollTop = container.scrollHeight;
}

// ---------- HELPERS ----------
function formatTime(date) {
    if (!date) return "";
    return new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function generateRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}

function scrollMessages() {
    const c = $("messages");
    if (c) c.scrollTop = c.scrollHeight;
}

// ---------- LEAVE ----------
$("leaveBtn").addEventListener("click", async () => {
    if (realtimeChannel) {
        await supabaseClient.removeChannel(realtimeChannel);
        realtimeChannel = null;
    }
    currentRoom = null;
    currentUser = null;
    $("messages").innerHTML = "";
    showPage("homePage");
});

// ---------- SEEN ----------
async function markSeen() {
    if (!currentRoom || !currentUser || document.hidden) return;
    await supabaseClient.rpc("mark_seen", {
        p_room: String(currentRoom.id),
        p_user: currentUser
    });
}
document.addEventListener("visibilitychange", markSeen);

// ---------- VOICE ----------
const voiceRecordBtn = $("voiceRecordBtn");
const originalMicHTML = voiceRecordBtn.innerHTML;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let recordInterval = null;

function startRecordTimer() {
    const el = $("typingIndicator");
    let seconds = 0;
    el.textContent = "🔴 Recording 0:00";
    recordInterval = setInterval(() => {
        seconds++;
        const m = Math.floor(seconds / 60);
        const s = String(seconds % 60).padStart(2, "0");
        el.textContent = "🔴 Recording " + m + ":" + s;
    }, 1000);
}

function stopRecordTimer() {
    clearInterval(recordInterval);
    recordInterval = null;
    $("typingIndicator").textContent = "";
}

voiceRecordBtn.addEventListener("click", async () => {
    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
            });

            const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
                ? { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 32000 }
                : {};

            mediaRecorder = new MediaRecorder(stream, options);
            audioChunks = [];

            mediaRecorder.ondataavailable = e => {
                if (e.data.size > 0) audioChunks.push(e.data);
            };

            mediaRecorder.onstop = async () => {
                stream.getTracks().forEach(t => t.stop());
                if (!currentRoom) return;

                const audioBlob = new Blob(audioChunks, { type: "audio/webm" });

                const pending = document.createElement("div");
                pending.className = "message mine";
                pending.innerHTML =
                    '<div class="message-bubble"><div class="message-text">🎤 Sending voice...</div></div>';
                $("messages").appendChild(pending);
                scrollMessages();

                const fileName = currentRoom.id + "/" + crypto.randomUUID() + ".webm";

                const { error: uploadError } = await supabaseClient
                    .storage.from("voice")
                    .upload(fileName, audioBlob, { contentType: "audio/webm" });

                if (uploadError) {
                    console.error(uploadError);
                    pending.remove();
                    alert("Voice upload failed.");
                    return;
                }

                const { data: urlData } = supabaseClient.storage.from("voice").getPublicUrl(fileName);

                const { error: insertError } = await supabaseClient.from("messages").insert({
                    room_id: currentRoom.id,
                    username: currentUser,
                    message: "",
                    audio_url: urlData.publicUrl,
                    reply_to: replyingTo
                });

                pending.remove();
                clearReply();

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
        // ---------- PHOTO / VIDEO ----------
const mediaFile = $("mediaFile");

$("attachBtn").addEventListener("click", () => {
    if (!currentRoom) return;
    mediaFile.click();
});

function compressImage(file) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            const max = 1280;
            const scale = Math.min(1, max / Math.max(img.width, img.height));
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(b => resolve(b || file), "image/jpeg", 0.8);
        };
        img.onerror = () => resolve(file);
        img.src = URL.createObjectURL(file);
    });
}

mediaFile.addEventListener("change", async () => {
    const file = mediaFile.files[0];
    mediaFile.value = "";
    if (!file || !currentRoom) return;

    const isVideo = file.type.startsWith("video");
    if (isVideo && file.size > 25 * 1024 * 1024) {
        alert("Video must be smaller than 25 MB.");
        return;
    }

    const pending = document.createElement("div");
    pending.className = "message mine";
    pending.innerHTML = '<div class="message-bubble"><div class="message-text">Sending...</div></div>';
    $("messages").appendChild(pending);
    scrollMessages();

    let body = file;
    let ext = "mp4";
    let type = file.type;

    if (!isVideo) {
        body = await compressImage(file);
        ext = "jpg";
        type = "image/jpeg";
    } else if (file.name.includes(".")) {
        ext = file.name.split(".").pop();
    }

    const path = currentRoom.id + "/" + crypto.randomUUID() + "." + ext;

    const { error: upErr } = await supabaseClient
        .storage.from("media")
        .upload(path, body, { contentType: type });

    if (upErr) {
        console.error(upErr);
        pending.remove();
        alert("Upload failed.");
        return;
    }

    const url = supabaseClient.storage.from("media").getPublicUrl(path).data.publicUrl;

    const { error } = await supabaseClient.from("messages").insert({
        room_id: currentRoom.id,
        username: currentUser,
        message: "",
        media_url: url,
        media_type: isVideo ? "video" : "image",
        reply_to: replyingTo
    });

    pending.remove();
    clearReply();

    if (error) {
        console.error(error);
        alert("Could not send.");
    }
});

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
        chip.appendChild(makeEmojiImg(emoji));
if (users.length > 1) chip.appendChild(document.createTextNode(" " + users.length));
        chip.addEventListener("click", () => alert(emoji + " by " + users.join(", ")));
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
    const old = document.querySelector(".");
    if (old) old.remove();
}

function openMessageMenu(message, wrapper) {
    closeMessageMenu();

    const menu = document.createElement("div");
    menu.className = "message-menu";

    // ---------- REACTIONS ----------
    
    REACTIONS.forEach(emoji => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "reaction-menu-btn";
    b.title = emoji;

    const img = makeEmojiImg(emoji);
    img.className = "ios-emoji reaction-menu-emoji";

    b.appendChild(img);

    b.addEventListener("click", async (e) => {
        e.stopPropagation();

        await sendReaction(message.id, emoji);
        closeMessageMenu();
    });

    menu.appendChild(b);
});

    // ---------- BUBBLE STYLE ----------
    const bubbleStyleBtn = document.createElement("button");
    bubbleStyleBtn.type = "button";
    bubbleStyleBtn.className = "message-menu-text-btn";
    bubbleStyleBtn.textContent = "Bubble Style";

    bubbleStyleBtn.addEventListener("click", () => {
        closeMessageMenu();
        openBubbleStylePicker(message, wrapper);
    });

    menu.appendChild(bubbleStyleBtn);

    // ---------- DELETE ----------
    if (message.username === currentUser) {
        const del = document.createElement("button");
        del.type = "button";
        del.className = "message-menu-text-btn danger";
        del.textContent = "Delete";

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

    // ---------- CANCEL ----------
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "message-menu-text-btn";
    cancel.textContent = "Cancel";

    cancel.addEventListener("click", closeMessageMenu);

    menu.appendChild(cancel);

    setTimeout(() => {
        document.addEventListener("pointerdown", outside);
    }, 300);
}
    
function openBubbleStylePicker(message, wrapper) {
    showSheet([
        ["Classic", () => applyBubbleStyle(message, "classic", wrapper)],
        ["Soft Cute", () => applyBubbleStyle(message, "soft", wrapper)],
        ["Gradient", () => applyBubbleStyle(message, "gradient", wrapper)],
        ["Glass", () => applyBubbleStyle(message, "glass", wrapper)],
        ["Flower Frame", () => applyBubbleStyle(message, "flower", wrapper)],
        ["Butterfly", () => applyBubbleStyle(message, "butterfly", wrapper)],
        ["Neon", () => applyBubbleStyle(message, "neon", wrapper)],
        ["Y2K", () => applyBubbleStyle(message, "y2k", wrapper)],
        ["Cancel", () => {}]
    ], "Bubble Style");
}
function attachLongPress(target, message, wrapper) {
    let timer;
    const start = () => { timer = setTimeout(() => openMessageMenu(message, wrapper), 600); };
    const cancel = () => clearTimeout(timer);

    target.addEventListener("touchstart", start, { passive: true });
    target.addEventListener("touchend", cancel);
    target.addEventListener("touchmove", cancel);
    target.addEventListener("mousedown", start);
    target.addEventListener("mouseup", cancel);
    target.addEventListener("mouseleave", cancel);
    target.addEventListener("contextmenu", e => e.preventDefault());
}

// ---------- REPLY ----------
function startReply(message) {
    replyingTo = {
        id: message.id,
        name: message.username === currentUser ? "You" : message.username,
        text: message.audio_url ? "🎤 Voice message"
            : message.media_url ? "📷 Photo/Video"
            : (message.message || "").slice(0, 80)
    };
    $("replyBarName").textContent = replyingTo.name;
    $("replyBarMsg").textContent = replyingTo.text;
    $("replyBar").classList.remove("hidden");
    $("messageInput").focus();
}

function clearReply() {
    replyingTo = null;
    $("replyBar").classList.add("hidden");
}

$("replyCancel").addEventListener("click", clearReply);

function attachSwipeReply(el, message) {
    let startX = 0, startY = 0, mode = null;

    el.addEventListener("touchstart", e => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        mode = null;
    }, { passive: true, capture: true });

    el.addEventListener("touchmove", e => {
        if (mode === "scroll") return;
        const dx = e.touches[0].clientX - startX;
        const dy = e.touches[0].clientY - startY;
        if (mode === null) {
            if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx) * 0.6) { mode = "scroll"; return; }
            if (Math.abs(dx) > 25 && Math.abs(dx) > Math.abs(dy) * 2.5) mode = "swipe";
            else return;
        }
        el.style.transform = "translateX(" + Math.max(-60, Math.min(60, dx)) + "px)";
    }, { passive: true, capture: true });

    const reset = () => {
        el.style.transition = "transform 0.2s";
        el.style.transform = "";
        setTimeout(() => { el.style.transition = ""; }, 200);
    };

    el.addEventListener("touchend", e => {
        const dx = e.changedTouches[0].clientX - startX;
        const wasSwipe = mode === "swipe";
        mode = null;
        reset();
        if (wasSwipe && Math.abs(dx) > 70) startReply(message);
    }, { capture: true });

    el.addEventListener("touchcancel", () => { mode = null; reset(); }, { capture: true });
}

function attachDoubleTap(el, message) {
    let last = 0;
    el.addEventListener("click", e => {
        if (e.target.closest("audio, video, .reaction-chip, .reply-quote")) return;
        const now = Date.now();
        if (now - last < 350) {
            last = 0;
            if (message.id) sendReaction(message.id, REACTIONS[0]);
        } else {
            last = now;
        }
    });
}

// ================================
// TYPING INDICATOR
// ================================

const typingUsers = {};
let lastTypingSent = 0;

function showTyping(user) {
    if (!user || user === currentUser) return;
    clearTimeout(typingUsers[user]);
    typingUsers[user] = setTimeout(() => {
        delete typingUsers[user];
        updateTyping();
    }, 3500);
    updateTyping();
}

function updateTyping() {
    if (isRecording) return;
    const names = Object.keys(typingUsers).filter(n => n !== currentUser);
    const box = $("messages");
    let el = $("typingBubble");

    if (!names.length) {
        if (el) el.remove();
        $("typingIndicator").textContent = "";
        return;
    }

    const who = names[0];
    if (!(who in avatarCache)) loadAvatars([who]).then(updateTyping);

    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
    if (!el) {
        el = document.createElement("div");
        el.id = "typingBubble";
        el.className = "message typing-msg";
        el.innerHTML =
            '<div class="msg-avatar"></div>' +
            '<div class="message-bubble typing-bubble"><i></i><i></i><i></i></div>';
    }
    const p = avatarCache[who];
    const av = el.querySelector(".msg-avatar");
    if (p && p.avatar_url) {
        av.style.backgroundImage = `url("${p.avatar_url}")`;
        av.textContent = "";
    } else {
        av.style.backgroundImage = "";
        av.textContent = ((p && p.display_name) || who).charAt(0).toUpperCase();
    }
    box.appendChild(el);
    if (nearBottom) box.scrollTop = box.scrollHeight;
}

function sendTyping() {
    if (!currentRoom || !realtimeChannel || !currentUser) return;
    const now = Date.now();
    if (now - lastTypingSent < 1500) return;
    lastTypingSent = now;
    realtimeChannel.send({
        type: "broadcast",
        event: "typing",
        payload: { username: currentUser }
    });
}

$("messageInput").addEventListener("input", () => {
    if (typeof syncSendMode === "function") syncSendMode();
    sendTyping();
});
// ---------- ROOM HEADER ----------
function setAvatar(el, url) {
    if (url) {
        el.style.backgroundImage = `url("${url}")`;
        el.textContent = "";
    } else {
        el.style.backgroundImage = "";
        el.textContent = "💬";
    }
}

function applyRoomHeader() {
    if (!currentRoom) return;
    $("roomName").textContent = currentRoom.room_name || "Private Room";
    setAvatar($("roomAvatar"), currentRoom.room_avatar);
}

$("callBtn").addEventListener("click", () => alert("Calling coming soon"));
$("videoBtn").addEventListener("click", () => alert("Video calling coming soon"));

let newAvatarBlob = null;

function openEditRoom() {
    if (!currentRoom) return;
    newAvatarBlob = null;
    $("roomNameInput").value = currentRoom.room_name || "";
    setAvatar($("editAvatarPreview"), currentRoom.room_avatar);
    $("editRoomModal").classList.remove("hidden");
}



$("cancelRoomBtn").addEventListener("click", () => $("editRoomModal").classList.add("hidden"));

$("avatarFile").addEventListener("change", e => {
    const file = e.target.files[0];
    if (!file) return;

    const img = new Image();
    img.onload = () => {
        const size = 256;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const side = Math.min(img.width, img.height);
        canvas.getContext("2d").drawImage(
            img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size
        );
        canvas.toBlob(blob => {
            newAvatarBlob = blob;
            setAvatar($("editAvatarPreview"), URL.createObjectURL(blob));
        }, "image/jpeg", 0.85);
    };
    img.src = URL.createObjectURL(file);
});
$("saveRoomBtn").addEventListener("click", async () => {
    const name = $("roomNameInput").value.trim() || null;
    let avatarUrl = null;

    if (newAvatarBlob) {
        const path = currentRoom.id + "/" + crypto.randomUUID() + ".jpg";
        const { error: upErr } = await supabaseClient
            .storage.from("avatars")
            .upload(path, newAvatarBlob, { contentType: "image/jpeg" });

        if (upErr) { console.error(upErr); alert("Photo upload failed."); return; }

        avatarUrl = supabaseClient.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    }

    const { error } = await supabaseClient.rpc("update_room", {
        p_id: String(currentRoom.id),
        p_password: currentRoom.password,
        p_name: name,
        p_avatar: avatarUrl
    });

    if (error) { console.error(error); alert("Could not save."); return; }

    currentRoom.room_name = name;
    if (avatarUrl) currentRoom.room_avatar = avatarUrl;
    applyRoomHeader();

    if (realtimeChannel) {
        realtimeChannel.send({
            type: "broadcast",
            event: "roomupdate",
            payload: { name: name, avatar: avatarUrl }
        });
    }

    $("editRoomModal").classList.add("hidden");
});
// ---------- IOS EMOJI ----------
const EMOJI_BASE =
    "https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.0.1/img/apple/64/";

const EMOJI_RE = /(?:\p{Regional_Indicator}{2})|(?:[#*0-9]\uFE0F?\u20E3)|(?:\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*)/gu;

function emojiFile(str, withFE0F) {
    let codes = Array.from(str).map(c =>
        c.codePointAt(0).toString(16).padStart(4, "0")
    );
    if (!withFE0F) codes = codes.filter(c => c !== "fe0f");
    return EMOJI_BASE + codes.join("-") + ".png";
}

function makeEmojiImg(str) {
    const img = document.createElement("img");
    img.className = "ios-emoji";
    img.alt = str;
    img.draggable = false;
    img.src = emojiFile(str, true);
    img.onerror = () => {
        if (!img.dataset.retry) {
            img.dataset.retry = "1";
            img.src = emojiFile(str, false);
        } else {
            img.replaceWith(document.createTextNode(str));
        }
    };
    return img;
}

function convertEmoji(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            const p = node.parentNode;
            if (!p || /^(SCRIPT|STYLE|TEXTAREA|INPUT)$/.test(p.nodeName)) {
                return NodeFilter.FILTER_REJECT;
            }
            EMOJI_RE.lastIndex = 0;
            return EMOJI_RE.test(node.nodeValue)
                ? NodeFilter.FILTER_ACCEPT
                : NodeFilter.FILTER_REJECT;
        }
    });

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    nodes.forEach(node => {
        const text = node.nodeValue;
        const frag = document.createDocumentFragment();
        let last = 0;

        for (const m of text.matchAll(EMOJI_RE)) {
            if (m.index > last) {
                frag.appendChild(document.createTextNode(text.slice(last, m.index)));
            }
            frag.appendChild(makeEmojiImg(m[0]));
            last = m.index + m[0].length;
        }
        if (last < text.length) {
            frag.appendChild(document.createTextNode(text.slice(last)));
        }
        node.replaceWith(frag);
    });
}

let emojiScheduled = false;
function scheduleEmoji() {
    if (emojiScheduled) return;
    emojiScheduled = true;
    requestAnimationFrame(() => {
        emojiScheduled = false;
        convertEmoji(document.body);
    });
}

new MutationObserver(scheduleEmoji).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
});

convertEmoji(document.body);
// ---------- MEDIA VIEWER ----------
function openMediaViewer(url, type) {
    const old = document.getElementById("mediaViewer");
    if (old) old.remove();

    const v = document.createElement("div");
    v.id = "mediaViewer";
    v.className = "media-viewer";

    const bar = document.createElement("div");
    bar.className = "mv-bar";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "mv-close";
    close.textContent = "×";
    close.addEventListener("click", () => v.remove());
    const save = document.createElement("button");
    save.type = "button";
    save.className = "mv-save";
    save.textContent = "Save";
    save.addEventListener("click", () => saveMedia(url, type, save));
    bar.append(close, save);

    let el;
    if (type === "video") {
        el = document.createElement("video");
        el.controls = true;
        el.autoplay = true;
        el.playsInline = true;
    } else {
        el = document.createElement("img");
    }
    el.src = url;
    el.className = "mv-media";

    v.append(bar, el);
    document.body.appendChild(v);
}

async function saveMedia(url, type, btn) {
    try {
        btn.textContent = "Saving...";
        const res = await fetch(url);
        const blob = await res.blob();
        const sub = (blob.type.split("/")[1] || "").replace("quicktime", "mov").replace("jpeg", "jpg");
        const ext = sub || (type === "video" ? "mp4" : "jpg");
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "private-room-" + Date.now() + "." + ext;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        btn.textContent = "Saved";
    } catch (e) {
        console.error(e);
        btn.textContent = "Save";
        window.open(url, "_blank");
    }
                                }
