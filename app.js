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
    const del = document.createElement("button");
    del.type = "button";
    del.textContent = "🗑️";
    del.title = "Delete";
    del.style.background = "none";
    del.style.border = "none";
    del.style.cursor = "pointer";
    del.style.fontSize = "14px";
    del.style.marginLeft = "8px";

    del.addEventListener("click", async () => {
        if (!confirm("Delete this message?")) return;

        const { data, error } = await supabaseClient
            .from("messages")
            .delete()
            .eq("id", message.id)
            .select();

        if (error || !data || data.length === 0) {
            console.error(error);
            alert("Delete failed: " + (error ? error.message : "no row deleted, id = " + message.id));
            return;
        }

        wrapper.remove();
    });

    bubble.appendChild(del);
}

    wrapper.dataset.messageId = message.id;
wrapper.appendChild(bubble);
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
    ? { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 128000 }
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
