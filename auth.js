// ================================
// auth.js  (login, tabs, chats, profile)
// Runs after app.js
// ================================

let authUser = null;
let myProfile = null;
let lastPage = "splashPage";
let profBlob = null;

const fakeEmail = u => u.toLowerCase() + "@privateroom.app";

// ---------- Wrap showPage / openChat ----------
const _showPage = showPage;
window.showPage = function (id) {
    if (id === "homePage" && lastPage === "chatPage") id = "chatsPage";
    _showPage(id);
    lastPage = id;
    updateNav(id);
    if (id === "chatsPage") loadChats();
    if (id === "profilePage") renderProfile();
};

const _openChat = openChat;
window.openChat = async function () {
    if (authUser && currentRoom) {
        await supabaseClient.from("room_members").upsert(
            { room_id: currentRoom.id, user_id: authUser.id },
            { onConflict: "room_id,user_id", ignoreDuplicates: true }
        );
    }
    if (!dmLoaded) await loadDmMap();
    const p = _openChat();
    applyDmHeader();
    return p;
};

function updateNav(id) {
    const hideOn = ["chatPage", "authPage", "splashPage"];
    $("bottomNav").classList.toggle("hidden", hideOn.includes(id));

    let key = "";
    if (["homePage", "createPage", "joinPage"].includes(id)) key = "rooms";
    if (id === "chatsPage") key = "chats";
    if (id === "profilePage") key = "me";

    document.querySelectorAll(".nav-btn").forEach(b => {
        b.classList.toggle("active", b.dataset.key === key);
    });
}

document.querySelectorAll(".nav-btn").forEach(b => {
    b.addEventListener("click", () => showPage(b.dataset.tab));
});

// ---------- AUTH UI ----------
function authMsg(text) {
    $("authMsg").textContent = text || "";
}

function setAuthTab(login) {
    $("loginForm").classList.toggle("hidden", !login);
    $("signupForm").classList.toggle("hidden", login);
    $("tabLogin").classList.toggle("active", login);
    $("tabSignup").classList.toggle("active", !login);
    authMsg("");
}

$("tabLogin").addEventListener("click", () => setAuthTab(true));
$("tabSignup").addEventListener("click", () => setAuthTab(false));

// ---------- SIGN UP ----------
$("signupForm").addEventListener("submit", async e => {
    e.preventDefault();
    authMsg("");

    const name = $("suName").value.trim();
    const username = $("suUsername").value.trim().toLowerCase();
    const pw = $("suPassword").value;
    const pw2 = $("suPassword2").value;

    if (!name) return authMsg("Please enter your name.");
    if (!/^[a-z0-9_.]{3,20}$/.test(username)) {
        return authMsg("Username must be 3-20 characters: a-z, 0-9, _ or .");
    }
    if (pw.length < 8) return authMsg("Password must be at least 8 characters.");
    if (pw !== pw2) return authMsg("Passwords do not match.");

    const { data: free } = await supabaseClient.rpc("username_available", {
        p_username: username
    });
    if (!free) return authMsg("This username is taken. Try another.");

    const { data, error } = await supabaseClient.auth.signUp({
        email: fakeEmail(username),
        password: pw
    });

    if (error) {
        console.error(error);
        return authMsg("Sign up failed: " + error.message);
    }
    if (!data.session) {
        return authMsg("Account created but not logged in. Check that Confirm email is OFF in Supabase.");
    }

    authUser = data.user;

    const { error: pe } = await supabaseClient.from("profiles").insert({
        id: authUser.id,
        username: username,
        display_name: name
    });

    if (pe) {
        console.error(pe);
        await supabaseClient.auth.signOut();
        return authMsg("Could not create profile. Username may be taken.");
    }

    await loadProfile();
    showPage("chatsPage");
});

// ---------- LOG IN ----------
$("loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    authMsg("");

    const username = $("liUsername").value.trim().toLowerCase();
    const pw = $("liPassword").value;
    if (!username || !pw) return authMsg("Enter both username and password.");

    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: fakeEmail(username),
        password: pw
    });

    if (error) {
        console.error(error);
        return authMsg("Wrong username or password.");
    }

    authUser = data.user;
    await loadProfile();

    if (!myProfile) {
        await supabaseClient.auth.signOut();
        return authMsg("Profile not found for this account.");
    }

    showPage("chatsPage");
});

// ---------- PROFILE ----------
async function loadProfile() {
    const { data } = await supabaseClient
        .from("profiles")
        .select("*")
        .eq("id", authUser.id)
        .maybeSingle();

    myProfile = data;

    if (myProfile) {
        localStorage.setItem("chatUsername", myProfile.username);
        $("username").value = myProfile.username;
        $("username").style.display = "none";
    }
}

function paintAvatar(el, url, label) {
    if (url) {
        el.style.backgroundImage = `url("${url}")`;
        el.textContent = "";
    } else {
        el.style.backgroundImage = "";
        el.textContent = (label || "?").charAt(0).toUpperCase();
    }
}

function renderProfile() {
    if (!myProfile) return;
    $("profName").textContent = myProfile.display_name || myProfile.username;
    $("profUsername").textContent = "@" + myProfile.username;
    $("profBio").textContent = myProfile.bio || "No bio yet.";
    paintAvatar($("profAvatar"), myProfile.avatar_url, myProfile.display_name || myProfile.username);
    loadStats();
    loadMyRooms();
}

async function loadStats() {
    const { data: rooms } = await supabaseClient.rpc("my_rooms");
    await loadDmMap();
    $("statRooms").textContent = rooms ? rooms.filter(r => !dmOf(r)).length : 0;

    const { count } = await supabaseClient
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("username", myProfile.username);
    $("statMsgs").textContent = count || 0;
    const fl = await fetchFriends();
    if ($("statFriends")) {
        $("statFriends").textContent = fl.filter(f => f.kind === "friend").length;
        const inc = fl.filter(f => f.kind === "incoming").length;
        $("statFriendsLbl").textContent = inc ? "Friends · " + inc + " new" : "Friends";
    }
}

$("profAvatar").addEventListener("click", () => $("editProfileBtn").click());
function timeAgo(d) {
    const mins = Math.floor((Date.now() - new Date(d)) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + " min ago";
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + " hr ago";
    if (hrs < 48) return "Yesterday";
    return new Date(d).toLocaleDateString();
}

async function loadMyRooms() {
    const list = $("myRoomsList");
    const [r1, r2] = await Promise.all([
        supabaseClient.rpc("my_rooms"),
        supabaseClient.rpc("my_room_stats")
    ]);
    if (r1.error) {
        console.error(r1.error);
        list.innerHTML = '<p class="empty">Could not load rooms.</p>';
        return;
    }
    await loadDmMap();
    const rooms = (r1.data || []).filter(r => !dmOf(r));
    const st = {};
    (r2.data || []).forEach(s => { st[s.room_id] = s; });

    list.innerHTML = "";
    if (!rooms.length) {
        list.innerHTML = '<p class="empty">No rooms yet.</p>';
        return;
    }

    rooms.forEach(room => {
        const s = st[String(room.id)] || {};
        const card = document.createElement("div");
        card.className = "room-card";

        const av = document.createElement("div");
        av.className = "room-avatar";
        setAvatar(av, room.room_avatar);

        const text = document.createElement("div");
        text.className = "room-card-text";
        const title = document.createElement("strong");
        title.textContent = "🔐 " + (room.room_name || "Room " + room.room_code);
        const meta = document.createElement("span");
        const n = s.member_count || 0;
meta.textContent = n + (n === 1 ? " member" : " members");
        const last = document.createElement("span");
        last.textContent = s.last_at ? "Last message • " + timeAgo(s.last_at) : "No messages yet";
        text.append(title, meta, last);

        const more = document.createElement("button");
        more.type = "button";
        more.className = "room-more";
        more.textContent = "⋮";
        more.addEventListener("click", e => {
            e.stopPropagation();
            openRoomActions(room);
        });

        card.append(av, text, more);
        card.addEventListener("click", () => openRoomFromProfile(room));
        list.appendChild(card);
    });
}

function openRoomFromProfile(room) {
    currentRoom = room;
    currentUser = myProfile.username;
    openChat();
}

function closeRoomActions() {
    const old = document.querySelector(".sheet-backdrop");
    if (old) old.remove();
}

function openRoomActions(room) {
    closeRoomActions();
    const back = document.createElement("div");
    back.className = "sheet-backdrop";
    const sheet = document.createElement("div");
    sheet.className = "sheet";

    const add = (label, fn, danger) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        if (danger) b.classList.add("danger");
        b.addEventListener("click", () => { closeRoomActions(); fn(); });
        sheet.appendChild(b);
    };

    add("Open chat", () => openRoomFromProfile(room));
    add("Delete chat", () => deleteChatForMe(room), true);
    add("Leave room", () => leaveRoom(room), true);
    add("Cancel", () => {});

    back.appendChild(sheet);
    back.addEventListener("click", e => { if (e.target === back) closeRoomActions(); });
    document.body.appendChild(back);
}

async function deleteChatForMe(room) {
    if (!confirm("Delete this chat?\nThis removes the conversation only for you. Other members will still see it.")) return;
    const { data, error } = await supabaseClient
        .from("room_members")
        .update({ cleared_at: new Date().toISOString() })
        .eq("room_id", room.id)
        .eq("user_id", authUser.id)
        .select();
    if (error || !data || !data.length) {
        console.error(error);
        alert("Could not delete chat.");
        return;
    }
    loadMyRooms();
}

async function leaveRoom(room) {
    if (!confirm("Leave this room?\nYou won't be able to access it unless you join again.")) return;
    const { data, error } = await supabaseClient
        .from("room_members")
        .delete()
        .eq("room_id", room.id)
        .eq("user_id", authUser.id)
        .select();
    if (error || !data || !data.length) {
        console.error(error);
        alert("Could not leave room.");
        return;
    }
    loadMyRooms();
    loadStats();
}

$("editProfileBtn").addEventListener("click", () => {
    profBlob = null;
    $("editName").value = myProfile.display_name || "";
    $("editBio").value = myProfile.bio || "";
    paintAvatar($("editProfAvatar"), myProfile.avatar_url, myProfile.display_name || myProfile.username);
    $("editProfileModal").classList.remove("hidden");
});

$("cancelProfileBtn").addEventListener("click", () => {
    $("editProfileModal").classList.add("hidden");
});

$("profFile").addEventListener("change", e => {
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
            profBlob = blob;
            paintAvatar($("editProfAvatar"), URL.createObjectURL(blob), "");
        }, "image/jpeg", 0.85);
    };
    img.src = URL.createObjectURL(file);
});

$("saveProfileBtn").addEventListener("click", async () => {
    const updates = {
        display_name: $("editName").value.trim() || myProfile.username,
        bio: $("editBio").value.trim()
    };

    if (profBlob) {
        const path = authUser.id + "/" + crypto.randomUUID() + ".jpg";
        const { error: upErr } = await supabaseClient
            .storage.from("avatars")
            .upload(path, profBlob, { contentType: "image/jpeg" });

        if (upErr) {
            console.error(upErr);
            alert("Photo upload failed.");
            return;
        }
        updates.avatar_url = supabaseClient.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    }

    const { error } = await supabaseClient
        .from("profiles")
        .update(updates)
        .eq("id", authUser.id);

    if (error) {
        console.error(error);
        alert("Could not save.");
        return;
    }

    await loadProfile();
    renderProfile();
    $("editProfileModal").classList.add("hidden");
});

$("logoutBtn").addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    authUser = null;
    myProfile = null;
    currentRoom = null;
    currentUser = null;
    showPage("authPage");
});

// ---------- CHATS LIST ----------
async function loadChats() {
    const list = $("chatsList");
    const { data, error } = await supabaseClient.rpc("my_rooms");

    if (error) {
        console.error(error);
        list.innerHTML = '<p class="empty">Could not load chats.</p>';
        return;
    }

    await loadDmMap();
    list.innerHTML = "";

    if (!data || !data.length) {
        list.innerHTML =
            '<p class="empty">No chats yet. Create or join a room from the Rooms tab.</p>';
        return;
    }

    data.forEach(room => {
        const dm = dmOf(room);

        const row = document.createElement("div");
        row.className = "chat-row";

        const av = document.createElement("div");
        av.className = "room-avatar";
        if (dm) paintAvatar(av, dm.avatar_url, dm.display_name || dm.username);
        else setAvatar(av, room.room_avatar);

        const text = document.createElement("div");
        text.className = "chat-row-text";

        const title = document.createElement("strong");
        title.textContent = dm
            ? (dm.display_name || dm.username)
            : (room.room_name || "Room " + room.room_code);

        const preview = document.createElement("span");
        preview.textContent = "...";

        text.appendChild(title);
        text.appendChild(preview);
        row.appendChild(av);
        row.appendChild(text);
        list.appendChild(row);

        row.addEventListener("click", () => {
            currentRoom = room;
            currentUser = myProfile.username;
            openChat();
        });

        supabaseClient
            .from("messages")
            .select("message,audio_url,media_url,username")
            .eq("room_id", room.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .then(({ data: last }) => {
                const m = last && last[0];
                if (!m) { preview.textContent = "No messages yet"; return; }
                const body = m.audio_url ? "Voice message"
                    : m.media_url ? "Photo/Video"
                    : m.message;
                preview.textContent =
                    (m.username === myProfile.username ? "You: " : m.username + ": ") + body;
            });
    });
}
// ---------- CHAT MENU (⋮) ----------
function showSheet(items, title) {
    closeRoomActions();
    const back = document.createElement("div");
    back.className = "sheet-backdrop";
    const sheet = document.createElement("div");
    sheet.className = "sheet";
    if (title) {
        const t = document.createElement("div");
        t.className = "sheet-title";
        t.textContent = title;
        sheet.appendChild(t);
    }
    items.forEach(([label, fn, danger]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        if (danger) b.classList.add("danger");
        b.addEventListener("click", () => { closeRoomActions(); fn(); });
        sheet.appendChild(b);
    });
    back.appendChild(sheet);
    back.addEventListener("click", e => { if (e.target === back) closeRoomActions(); });
    document.body.appendChild(back);
    return sheet;
}

function openChatMenu() {
    if (!currentRoom) return;
    if (dmOf(currentRoom)) {
        showSheet([
            ["Search messages", openSearch],
            ["Delete chat", clearChatFromChat, true],
            ["Cancel", () => {}]
        ]);
        return;
    }
    showSheet([
        ["Room info", openRoomInfo],
        ["Members", showMembers],
        ["Search messages", openSearch],
        ["Delete chat", clearChatFromChat, true],
        ["Leave room", leaveFromChat, true],
        ["Cancel", () => {}]
    ]);
}
$("editRoomBtn").addEventListener("click", openChatMenu);

async function showMembers() {
    const { data, error } = await supabaseClient.rpc("room_member_list", {
        p_room: String(currentRoom.id)
    });
    if (error) { console.error(error); alert("Could not load members."); return; }
    const list = data || [];
    const sheet = showSheet([["Close", () => {}]], "Members (" + list.length + ")");
    const wrap = document.createElement("div");
    wrap.className = "member-list";
    list.forEach(m => {
        const row = document.createElement("div");
        row.className = "member-row";
        const av = document.createElement("div");
        av.className = "member-av";
        paintAvatar(av, m.avatar_url, m.display_name || m.username);
        const txt = document.createElement("div");
        txt.className = "member-text";
        const n = document.createElement("strong");
        n.textContent = m.display_name || m.username;
        const u = document.createElement("span");
        u.textContent = "@" + m.username;
        txt.append(n, u);
        row.append(av, txt);
        wrap.appendChild(row);
    });
    sheet.insertBefore(wrap, sheet.lastChild);
}

function filterMessages() {
    const bar = $("searchBar");
    const q = bar ? bar.querySelector("input").value.trim().toLowerCase() : "";
    document.querySelectorAll("#messages .message").forEach(m => {
        m.classList.toggle("search-hide", !!q && !m.textContent.toLowerCase().includes(q));
    });
}

function openSearch() {
    let bar = $("searchBar");
    if (!bar) {
        bar = document.createElement("div");
        bar.id = "searchBar";
        bar.className = "search-bar";
        bar.innerHTML = '<input type="text" placeholder="Search messages..."><button type="button">✕</button>';
        $("messages").before(bar);
        bar.querySelector("input").addEventListener("input", filterMessages);
        bar.querySelector("button").addEventListener("click", closeSearch);
    }
    bar.classList.remove("hidden");
    bar.querySelector("input").focus();
}

function closeSearch() {
    const bar = $("searchBar");
    if (!bar) return;
    bar.querySelector("input").value = "";
    filterMessages();
    bar.classList.add("hidden");
}
$("leaveBtn").addEventListener("click", closeSearch);

async function clearChatFromChat() {
    if (!confirm("Delete this chat?\nThis removes the conversation only for you. Other members will still see it.")) return;
    const { data, error } = await supabaseClient
        .from("room_members")
        .update({ cleared_at: new Date().toISOString() })
        .eq("room_id", currentRoom.id)
        .eq("user_id", authUser.id)
        .select();
    if (error || !data || !data.length) {
        console.error(error);
        alert("Could not delete chat.");
        return;
    }
    $("messages").innerHTML = "";
}

async function leaveFromChat() {
    if (!confirm("Leave this room?\nYou won't be able to access it unless you join again.")) return;
    const { data, error } = await supabaseClient
        .from("room_members")
        .delete()
        .eq("room_id", currentRoom.id)
        .eq("user_id", authUser.id)
        .select();
    if (error || !data || !data.length) {
        console.error(error);
        alert("Could not leave room.");
        return;
    }
    $("leaveBtn").click();
}
// ---------- ☰ MAIN MENU ----------
function openMainMenu() {
    if (!myProfile) return;
    showSheet([
        ["Edit profile", () => $("editProfileBtn").click()],
        ["Friends", openFriends],
        ["Change password", openChangePassword],
        ["Appearance", openAppearance],
        ["Your Activity", openActivity],
        ["Log out of all devices", logoutEverywhere],
        ["Help & Support", () => alert("Need help?\n\n• Rooms tab: create or join a room\n• Chats tab: your rooms\n• Long-press a message to react or delete\n• Swipe a message to reply")],
        ["About Private Room", () => alert("Private Room\nA private space for your group.")],
        ["Log out", () => $("logoutBtn").click(), true],
        ["Cancel", () => {}]
    ], myProfile.display_name || myProfile.username);
}
$("menuBtn").addEventListener("click", openMainMenu);

async function logoutEverywhere() {
    if (!confirm("Log out from all devices?")) return;
    await supabaseClient.auth.signOut({ scope: "global" });
    authUser = null;
    myProfile = null;
    currentRoom = null;
    currentUser = null;
    showPage("authPage");
}

// ---------- CHANGE PASSWORD ----------
function openChangePassword() {
    const old = $("pwModal");
    if (old) old.remove();

    const m = document.createElement("div");
    m.id = "pwModal";
    m.className = "modal";
    m.innerHTML =
        '<div class="modal-card">' +
        '<h3>Change password</h3>' +
        '<input id="pwOld" type="password" placeholder="Current password" autocomplete="current-password">' +
        '<input id="pwNew" type="password" placeholder="New password (min 8 characters)" autocomplete="new-password">' +
        '<input id="pwNew2" type="password" placeholder="Confirm new password" autocomplete="new-password">' +
        '<p id="pwMsg" class="auth-msg"></p>' +
        '<button type="button" id="pwSave" class="primary-btn">Change password</button>' +
        '<button type="button" id="pwCancel" class="secondary-btn">Cancel</button>' +
        '</div>';
    document.body.appendChild(m);

    const msg = t => { $("pwMsg").textContent = t || ""; };
    $("pwCancel").addEventListener("click", () => m.remove());

    $("pwSave").addEventListener("click", async () => {
        const oldPw = $("pwOld").value;
        const newPw = $("pwNew").value;
        const newPw2 = $("pwNew2").value;
        msg("");

        if (!oldPw || !newPw || !newPw2) return msg("Fill in all fields.");
        if (newPw.length < 8) return msg("New password must be at least 8 characters.");
        if (newPw !== newPw2) return msg("New passwords do not match.");
        if (newPw === oldPw) return msg("New password must be different.");

        const { error: checkErr } = await supabaseClient.auth.signInWithPassword({
            email: fakeEmail(myProfile.username),
            password: oldPw
        });
        if (checkErr) return msg("Current password is wrong.");

        const { error } = await supabaseClient.auth.updateUser({ password: newPw });
        if (error) {
            console.error(error);
            return msg("Could not change password: " + error.message);
        }

        m.remove();
        alert("Password changed.");
    });
}
// ---------- THEMES ----------
const THEMES = [
    ["rose", "Dusty Rose"],
    ["blush", "Blush"],
    ["sage", "Sage"],
    ["lavender", "Lavender"],
    ["midnight", "Midnight"]
];

function applyTheme(name) {
    if (!THEMES.some(t => t[0] === name)) name = "rose";
    if (name === "rose") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", name);
    try { localStorage.setItem("theme", name); } catch (e) {}
}

function openAppearance() {
    const cur = localStorage.getItem("theme") || "rose";
    const items = THEMES.map(([key, label]) => [
        (key === cur ? "✓ " : "") + label,
        () => applyTheme(key)
    ]);
    items.push(["Cancel", () => {}]);
    showSheet(items, "Appearance");
}

applyTheme(localStorage.getItem("theme") || "rose");

// ---------- YOUR ACTIVITY ----------
async function openActivity() {
    const count = async col => {
        let q = supabaseClient
            .from("messages")
            .select("id", { count: "exact", head: true })
            .eq("username", myProfile.username);
        if (col) q = q.not(col, "is", null);
        const { count: c } = await q;
        return c || 0;
    };
    const [rooms, msgs, media, voice] = await Promise.all([
        supabaseClient.rpc("my_rooms"),
        count(),
        count("media_url"),
        count("audio_url")
    ]);
    showSheet([
        ["Rooms joined: " + ((rooms.data || []).length), () => {}],
        ["Messages sent: " + msgs, () => {}],
        ["Photos/videos shared: " + media, () => {}],
        ["Voice messages: " + voice, () => {}],
        ["Close", () => {}]
    ], "Your Activity");
}
// ---------- DIRECT MESSAGES ----------
let dmMap = {};
let dmLoaded = false;

async function loadDmMap() {
    const { data, error } = await supabaseClient.rpc("my_dm_partners");
    if (error) { console.error(error); return; }
    dmMap = {};
    (data || []).forEach(d => { dmMap[String(d.room_id)] = d; });
    dmLoaded = true;
}

function dmOf(room) {
    return room ? dmMap[String(room.id)] : null;
}

function applyDmHeader() {
    const dm = dmOf(currentRoom);
    if (!dm) return;
    $("roomName").textContent = dm.display_name || dm.username;
    $("roomLabel").textContent = "@" + dm.username;
    paintAvatar($("roomAvatar"), dm.avatar_url, dm.display_name || dm.username);
}

$("headerInfo").addEventListener("click", e => {
    if (dmOf(currentRoom)) e.stopImmediatePropagation();
}, true);

$("newDmBtn").addEventListener("click", openNewDm);

function openNewDm() {
    const old = $("dmModal");
    if (old) old.remove();

    const m = document.createElement("div");
    m.id = "dmModal";
    m.className = "modal";
    m.innerHTML =
        '<div class="modal-card">' +
        '<h3>New message</h3>' +
        '<input id="dmUser" type="text" placeholder="Their username" autocapitalize="none" autocomplete="off">' +
        '<p id="dmMsg" class="auth-msg"></p>' +
        '<button type="button" id="dmGo" class="primary-btn">Start chat</button>' +
        '<button type="button" id="dmCancel" class="secondary-btn">Cancel</button>' +
        '</div>';
    document.body.appendChild(m);

    $("dmCancel").addEventListener("click", () => m.remove());

    $("dmGo").addEventListener("click", async () => {
        const u = $("dmUser").value.trim().toLowerCase().replace(/^@/, "");
        if (!u) { $("dmMsg").textContent = "Enter a username."; return; }

        const { data, error } = await supabaseClient
            .rpc("start_dm", { p_username: u })
            .single();

        if (error || !data) {
            console.error(error);
            $("dmMsg").textContent = error ? error.message : "Could not start chat.";
            return;
        }

        m.remove();
        currentRoom = data;
        currentUser = myProfile.username;
        await loadDmMap();
        openChat();
    });
}
// ---------- FRIENDS ----------
async function fetchFriends() {
    const { data, error } = await supabaseClient.rpc("friend_list");
    if (error) { console.error(error); return []; }
    return data || [];
}

const _fb = $("statFriendsBox");
if (_fb) _fb.addEventListener("click", openFriends);

function friendRow(f, buttons) {
    const row = document.createElement("div");
    row.className = "member-row";
    const av = document.createElement("div");
    av.className = "member-av";
    paintAvatar(av, f.avatar_url, f.display_name || f.username);
    const txt = document.createElement("div");
    txt.className = "member-text";
    const n = document.createElement("strong");
    n.textContent = f.display_name || f.username;
    const u = document.createElement("span");
    u.textContent = "@" + f.username;
    txt.append(n, u);
    row.append(av, txt);
    const act = document.createElement("div");
    act.className = "friend-actions";
    buttons.forEach(([label, fn, danger]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        if (danger) b.classList.add("danger");
        b.addEventListener("click", fn);
        act.appendChild(b);
    });
    row.appendChild(act);
    return row;
}

async function renderFriends() {
    const box = $("frList");
    if (!box) return;
    const all = await fetchFriends();
    box.innerHTML = "";

    const section = (title, rows) => {
        if (!rows.length) return;
        const t = document.createElement("p");
        t.className = "myrooms-title";
        t.textContent = title;
        box.appendChild(t);
        rows.forEach(r => box.appendChild(r));
    };

    const act = async (fn) => { await fn(); await renderFriends(); };

    section("REQUESTS", all.filter(f => f.kind === "incoming").map(f =>
        friendRow(f, [
            ["Accept", () => act(() => supabaseClient.rpc("respond_friend_request", { p_id: f.fid, p_accept: true }))],
            ["Decline", () => act(() => supabaseClient.rpc("respond_friend_request", { p_id: f.fid, p_accept: false })), true]
        ])
    ));

    section("FRIENDS", all.filter(f => f.kind === "friend").map(f =>
        friendRow(f, [
            ["Message", () => messageFriend(f)],
            ["Remove", () => {
                if (!confirm("Remove " + (f.display_name || f.username) + " from friends?")) return;
                act(() => supabaseClient.rpc("remove_friend", { p_id: f.fid }));
            }, true]
        ])
    ));

    section("SENT", all.filter(f => f.kind === "outgoing").map(f =>
        friendRow(f, [
            ["Cancel", () => act(() => supabaseClient.rpc("remove_friend", { p_id: f.fid })), true]
        ])
    ));

    if (!all.length) {
        box.innerHTML = '<p class="empty">No friends yet. Add someone by username.</p>';
    }
}

async function messageFriend(f) {
    const { data, error } = await supabaseClient
        .rpc("start_dm", { p_username: f.username })
        .single();
    if (error || !data) {
        console.error(error);
        alert(error ? error.message : "Could not start chat.");
        return;
    }
    const m = $("friendsModal");
    if (m) m.remove();
    currentRoom = data;
    currentUser = myProfile.username;
    await loadDmMap();
    openChat();
}

function openFriends() {
    if (!myProfile) return;
    const old = $("friendsModal");
    if (old) old.remove();

    const m = document.createElement("div");
    m.id = "friendsModal";
    m.className = "modal";
    m.innerHTML =
        '<div class="modal-card friends-card">' +
        '<h3>Friends</h3>' +
        '<div class="friend-add">' +
        '<input id="frUser" type="text" placeholder="Add by username" autocapitalize="none" autocomplete="off">' +
        '<button type="button" id="frAdd" class="primary-btn">Add</button>' +
        '</div>' +
        '<p id="frMsg" class="auth-msg"></p>' +
        '<div id="frList"></div>' +
        '<button type="button" id="frClose" class="secondary-btn">Close</button>' +
        '</div>';
    document.body.appendChild(m);

    $("frClose").addEventListener("click", () => { m.remove(); loadStats(); });

    $("frAdd").addEventListener("click", async () => {
        const u = $("frUser").value.trim().toLowerCase().replace(/^@/, "");
        if (!u) { $("frMsg").textContent = "Enter a username."; return; }
        const { data, error } = await supabaseClient.rpc("send_friend_request", { p_username: u });
        if (error) {
            console.error(error);
            $("frMsg").textContent = error.message;
            return;
        }
        const texts = {
            sent: "Request sent.",
            accepted: "You are now friends!",
            already_friends: "You are already friends.",
            already_sent: "Request already sent."
        };
        $("frMsg").textContent = texts[data] || "Done.";
        $("frUser").value = "";
        renderFriends();
    });

    renderFriends();
}
// ---------- ROOM INFO ----------
$("headerInfo").addEventListener("click", openRoomInfo);

async function openRoomInfo() {
    if (!currentRoom) return;
    const old = $("roomInfoModal");
    if (old) old.remove();

    const m = document.createElement("div");
    m.id = "roomInfoModal";
    m.className = "modal";
    m.innerHTML =
        '<div class="modal-card info-card">' +
        '<div id="riAvatar" class="room-avatar big"></div>' +
        '<h3 id="riName"></h3>' +
        '<div class="ri-code"><span>Room code</span><strong id="riCode"></strong>' +
        '<button type="button" id="riCopy">Copy</button></div>' +
        '<p id="riCount" class="myrooms-title"></p>' +
        '<div id="riMembers" class="member-list"></div>' +
        '<button type="button" id="riEdit" class="secondary-btn">Edit name &amp; photo</button>' +
        '<button type="button" id="riClose" class="primary-btn">Close</button>' +
        '</div>';
    document.body.appendChild(m);

    setAvatar($("riAvatar"), currentRoom.room_avatar);
    $("riName").textContent = currentRoom.room_name || "Private Room";
    $("riCode").textContent = currentRoom.room_code;

    $("riClose").addEventListener("click", () => m.remove());
    $("riEdit").addEventListener("click", () => { m.remove(); openEditRoom(); });
    $("riCopy").addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(currentRoom.room_code);
            $("riCopy").textContent = "Copied ✓";
        } catch (e) {
            alert("Room code: " + currentRoom.room_code);
        }
    });

    const { data, error } = await supabaseClient.rpc("room_member_list", {
        p_room: String(currentRoom.id)
    });
    if (error) { console.error(error); $("riCount").textContent = "MEMBERS"; return; }

    const list = data || [];
    $("riCount").textContent = list.length + (list.length === 1 ? " MEMBER" : " MEMBERS");
    list.forEach(p => {
        const row = document.createElement("div");
        row.className = "member-row";
        const av = document.createElement("div");
        av.className = "member-av";
        paintAvatar(av, p.avatar_url, p.display_name || p.username);
        const txt = document.createElement("div");
        txt.className = "member-text";
        const n = document.createElement("strong");
        n.textContent = p.display_name || p.username;
        const u = document.createElement("span");
        u.textContent = "@" + p.username;
        txt.append(n, u);
        row.append(av, txt);
        $("riMembers").appendChild(row);
    });
}
// ---------- START ----------
(async function init() {
    const { data: { session } } = await supabaseClient.auth.getSession();

    if (session) {
        authUser = session.user;
        await loadProfile();
    }

    if (myProfile) {
        showPage("chatsPage");
    } else {
        if (session) await supabaseClient.auth.signOut();
        showPage("authPage");
    }
})();
