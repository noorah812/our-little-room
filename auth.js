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
    if (id === "homePage") loadHomeRooms();
};

const _openChat = openChat;
window.openChat = async function () {
    if (authUser && currentRoom) {
        await supabaseClient.from("room_members").upsert(
            { room_id: currentRoom.id, user_id: authUser.id },
            { onConflict: "room_id,user_id", ignoreDuplicates: true }
        );
    }
    await loadDmMap();
    const p = _openChat();
    applyDmHeader();
    dmLockCheck();
    return p;
};

function updateNav(id) {
    const hideOn = ["chatPage", "authPage", "splashPage"];
    $("bottomNav").classList.toggle("hidden", hideOn.includes(id));

    let key = "";
    if (["homePage", "createPage", "joinPage"].includes(id)) key = "rooms";
    if (id === "chatsPage") key = "chats";
    if (id === "profilePage") key = "me";
    if (id === "searchPage") key = "search";

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
    const [r1, r2] = await Promise.all([
        supabaseClient.rpc("my_rooms"),
        supabaseClient.rpc("my_unread")
    ]);

    if (r1.error) {
        console.error(r1.error);
        list.innerHTML = '<p class="empty">Could not load chats.</p>';
        return;
    }

    await loadDmMap();
    try { await loadChatExtras(); } catch (e) { console.error(e); }

    const unread = {};
    (r2.data || []).forEach(u => { unread[u.room_id] = Number(u.n); });

    const all = r1.data || [];
    const reqs = all.filter(isIncomingReq);
    const rooms = all.filter(r => !isIncomingReq(r) && !isClearedEmpty(r));

    list.innerHTML = "";

    const rr = document.createElement("div");
    rr.className = "chat-row";
    const rav = document.createElement("div");
    rav.className = "room-avatar";
    rav.textContent = "✉️";
    const rtext = document.createElement("div");
    rtext.className = "chat-row-text";
    const rt = document.createElement("strong");
    rt.textContent = "Message requests";
    const rs = document.createElement("span");
    rs.textContent = reqs.length ? reqs.length + " new" : "No new requests";
    rtext.append(rt, rs);
    rr.append(rav, rtext);
    if (reqs.length) {
        const b = document.createElement("span");
        b.className = "unread-badge";
        b.textContent = reqs.length;
        rr.appendChild(b);
    }
    rr.addEventListener("click", openRequests);
    list.appendChild(rr);

    if (!rooms.length) {
        const p = document.createElement("p");
        p.className = "empty";
        p.textContent = "No chats yet. Create or join a room from the Rooms tab.";
        list.appendChild(p);
        return;
    }

    rooms.forEach(room => {
        try {
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

            const n = unread[String(room.id)];
            if (n) {
                const b = document.createElement("span");
                b.className = "unread-badge";
                b.textContent = n > 99 ? "99+" : n;
                row.appendChild(b);
            }

            list.appendChild(row);

            row.addEventListener("click", () => {
                currentRoom = room;
                currentUser = myProfile.username;
                openChat();
            });

            try { attachRowMenu(row, room); } catch (e) { console.error(e); }

            supabaseClient
                .from("messages")
                .select("message,audio_url,media_url,username")
                .eq("room_id", room.id)
                .gt("created_at", clearedMap[String(room.id)] || "1970-01-01T00:00:00Z")
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
                })
                .catch(() => { preview.textContent = ""; });
        } catch (e) {
            console.error("chat row failed", e);
        }
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
function openChatThemePicker() {
    alert("THEME PICKER WORKS");
}
async function openChatMenu() {
    if (!currentRoom) return;

    const dm = dmOf(currentRoom);

    if (dm) {
        await loadBlocks();

        showSheet([
            ["Search messages", openSearch],
            ["Chat Theme", openChatThemePicker],
            [blockedNames.has(dm.username) ? "Unblock" : "Block", () => toggleBlock(dm), true],
            ["Delete chat", clearChatFromChat, true],
            ["Cancel", () => {}]
        ]);

        return;
    }

    showSheet([
        ["Room info", openRoomInfo],
        ["Members", showMembers],
        ["Search messages", openSearch],
        ["Chat Theme", openChatThemePicker],
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
        row.style.cursor = "pointer";
        row.addEventListener("click", () => { closeRoomActions(); openUserProfile(m.username); });
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


$("headerInfo").addEventListener("click", openRoomInfo);

function openNewDm() {
    const old = $("dmModal");
    if (old) old.remove();

    const m = document.createElement("div");
    m.id = "dmModal";
    m.className = "modal";
    m.innerHTML =
        '<div class="modal-card">' +
        '<h3>New message</h3>' +
        '<p class="subtitle">Friends get your message directly. Everyone else gets a message request.</p>' +
        '<input id="dmUser" type="text" placeholder="Their username" autocapitalize="none" autocomplete="off">' +
        '<p id="dmMsg" class="auth-msg"></p>' +
        '<button type="button" id="dmGo" class="primary-btn">Start chat</button>' +
        '<button type="button" id="dmCancel" class="secondary-btn">Cancel</button>' +
        '</div>';
    document.body.appendChild(m);

    $("dmCancel").addEventListener("click", () => m.remove());

    $("dmGo").addEventListener("click", async () => {
        const btn = $("dmGo");
        const u = $("dmUser").value.trim().toLowerCase().replace(/^@/, "");
        if (!u) { $("dmMsg").textContent = "Enter a username."; return; }

        btn.disabled = true;
        btn.textContent = "Starting...";
        const { data, error } = await supabaseClient
            .rpc("start_dm", { p_username: u })
            .single();
        btn.disabled = false;
        btn.textContent = "Start chat";

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
    [av, txt].forEach(x => x.addEventListener("click", () => {
        const fm = $("friendsModal");
        if (fm) fm.remove();
        openUserProfile(f.username);
    }));
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

function openFriendsOld() {
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
    const frRes = document.createElement("div");
    frRes.id = "frResults";
    $("frMsg").after(frRes);
    attachUserSearch($("frUser"), frRes, friendSearchButtons, $("frList"));

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
    const dm = dmOf(currentRoom);
    if (dm) { openUserProfile(dm.username); return; }
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
        row.style.cursor = "pointer";
        row.addEventListener("click", () => { m.remove(); openUserProfile(p.username); });
        $("riMembers").appendChild(row);
    });
}
// ---------- SEND MODE + TYPING ----------

function syncSendMode() {
    const has = $("messageInput").value.trim().length > 0;
    $("messageForm").classList.toggle("has-text", has);
}

let typingTimer = null;

function handleTypingInput() {
    syncSendMode();

    if (!currentRoom || !realtimeChannel || !currentUser) return;

    realtimeChannel.send({
        type: "broadcast",
        event: "typing",
        payload: {
            username: currentUser
        }
    });

    clearTimeout(typingTimer);

    typingTimer = setTimeout(() => {
        // receiver automatically hides it after timeout
    }, 1000);
}

$("messageInput").addEventListener("input", handleTypingInput);
// ---------- USER PROFILE VIEW ----------
async function openUserProfileOld(username) {
    if (!username) return;
    const old = $("userProfileModal");
    if (old) old.remove();

    const { data, error } = await supabaseClient.rpc("get_profile", { p_username: username });
    const p = data && data[0];
    if (error || !p) {
        if (error) console.error(error);
        alert("No profile found for \"" + username + "\".\n(Purane messages, jo account banne se pehle ke hain, un ki profile nahi hoti.)");
        return;
    }

    const isMe = myProfile && p.username === myProfile.username;
    const m = document.createElement("div");
    m.id = "userProfileModal";
    m.className = "modal";

    const card = document.createElement("div");
    card.className = "modal-card up-card";

    const av = document.createElement("div");
    av.className = "up-avatar";
    paintAvatar(av, p.avatar_url, p.display_name || p.username);

    const nm = document.createElement("h3");
    nm.className = "up-name";
    nm.textContent = p.display_name || p.username;
    const un = document.createElement("p");
    un.className = "up-user";
    un.textContent = "@" + p.username;
    const bio = document.createElement("p");
    bio.className = "up-bio";
    bio.textContent = p.bio || "";

    card.append(av, nm, un, bio);

    const btn = (label, cls, fn, disabled) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = cls;
        b.textContent = label;
        if (disabled) b.disabled = true;
        else b.addEventListener("click", fn);
        card.appendChild(b);
    };
    const reload = () => openUserProfile(p.username);

    if (isMe) {
        const you = document.createElement("p");
        you.className = "up-user";
        you.textContent = "This is you";
        card.appendChild(you);
    } else {
        btn("Message", "primary-btn", () => { m.remove(); messageFriend({ username: p.username }); });

        if (p.friend_status === "none") {
            btn("Add friend", "secondary-btn", async () => {
                const { error: e } = await supabaseClient.rpc("send_friend_request", { p_username: p.username });
                if (e) { alert(e.message); return; }
                reload();
            });
        } else if (p.friend_status === "outgoing") {
            btn("Request sent", "secondary-btn", null, true);
        } else if (p.friend_status === "incoming") {
            btn("Accept friend request", "secondary-btn", async () => {
                await supabaseClient.rpc("respond_friend_request", { p_id: p.fid, p_accept: true });
                reload();
            });
        } else if (p.friend_status === "friend") {
            btn("Remove friend", "secondary-btn", async () => {
                if (!confirm("Remove " + (p.display_name || p.username) + " from friends?")) return;
                await supabaseClient.rpc("remove_friend", { p_id: p.fid });
                reload();
            });
        }
    }

    btn("Close", "secondary-btn", () => m.remove());
    m.appendChild(card);
    m.addEventListener("click", e => { if (e.target === m) m.remove(); });
    document.body.appendChild(m);
}
// ---------- MESSAGE REQUESTS ----------
function isIncomingReq(room) {
    const d = dmOf(room);
    return !!(d && d.dm_status === "pending" && d.mine !== true);
}

async function openRequests() {
    const old = $("reqModal");
    if (old) old.remove();

    const m = document.createElement("div");
    m.id = "reqModal";
    m.className = "modal";
    m.innerHTML =
        '<div class="modal-card friends-card">' +
        '<h3>Message requests</h3>' +
        '<div id="reqList"></div>' +
        '<button type="button" id="reqClose" class="secondary-btn">Close</button>' +
        '</div>';
    document.body.appendChild(m);

    $("reqClose").addEventListener("click", () => { m.remove(); loadChats(); });
    renderRequests(m);
}

async function renderRequests(m) {
    const box = $("reqList");
    if (!box) return;
    await loadDmMap();
    const { data } = await supabaseClient.rpc("my_rooms");
    const reqs = (data || []).filter(isIncomingReq);
    box.innerHTML = "";

    if (!reqs.length) {
        box.innerHTML = '<p class="empty">No requests.</p>';
        return;
    }

    reqs.forEach(room => {
        const d = dmOf(room);
        const row = friendRow(d, [
            ["Accept", async () => {
                await supabaseClient.rpc("respond_dm_request", { p_room: String(room.id), p_accept: true });
                await loadDmMap();
                m.remove();
                currentRoom = room;
                currentUser = myProfile.username;
                openChat();
            }],
            ["Decline", async () => {
                if (!confirm("Decline this request?\nTheir message will be deleted.")) return;
                await supabaseClient.rpc("respond_dm_request", { p_room: String(room.id), p_accept: false });
                renderRequests(m);
            }, true]
        ]);
        box.appendChild(row);

        supabaseClient
            .from("messages")
            .select("message,audio_url,media_url")
            .eq("room_id", room.id)
            .order("created_at", { ascending: true })
            .limit(1)
            .then(({ data: first }) => {
                const f = first && first[0];
                if (!f) return;
                row.querySelector(".member-text span").textContent =
                    f.audio_url ? "Voice message" : f.media_url ? "Photo/Video" : f.message;
            });
    });
}

// ---------- DM LOCK (pending request) ----------
async function answerDm(accept) {
    const room = currentRoom;
    if (!room) return;
    await supabaseClient.rpc("respond_dm_request", { p_room: String(room.id), p_accept: accept });
    await loadDmMap();
    if (accept) dmLockCheck();
    else $("leaveBtn").click();
}

function dmLockCheck() {
    const dm = dmOf(currentRoom);
    const pending = !!(dm && dm.dm_status === "pending");
    const outgoing = pending && dm.mine === true;
    const incoming = pending && dm.mine !== true;
    const sentOne = document.querySelectorAll("#messages .message.mine").length >= 1;
    const lock = incoming || (outgoing && sentOne);

    const input = $("messageInput");
    input.disabled = lock;
    input.placeholder = lock ? "You can chat after the request is accepted" : "Write a message...";
    ["attachBtn", "voiceRecordBtn"].forEach(id => {
        const b = $(id);
        b.disabled = lock;
        b.style.opacity = lock ? "0.4" : "";
    });

    let note = $("dmNote");
    if (!pending) {
        if (note) note.remove();
        return;
    }
    if (!note) {
        note = document.createElement("div");
        note.id = "dmNote";
        note.className = "dm-note";
        $("messageForm").before(note);
    }

    const state = incoming ? "in" : "out";
    if (note.dataset.state === state) return;
    note.dataset.state = state;
    note.innerHTML = "";

    if (outgoing) {
        note.textContent = "Message request sent. You can chat once they accept.";
    } else {
        const t = document.createElement("span");
        t.textContent = (dm.display_name || dm.username) + " wants to message you.";
        const a = document.createElement("button");
        a.type = "button";
        a.textContent = "Accept";
        a.addEventListener("click", () => answerDm(true));
        const d = document.createElement("button");
        d.type = "button";
        d.className = "danger";
        d.textContent = "Decline";
        d.addEventListener("click", () => {
            if (confirm("Decline this request?\nTheir message will be deleted.")) answerDm(false);
        });
        note.append(t, a, d);
    }
}

new MutationObserver(dmLockCheck).observe($("messages"), { childList: true });
// ---------- USER PROFILE PAGE (Instagram style) ----------
async function openUserProfile(username) {
    if (!username) return;
    const old = $("userProfilePage");
    if (old) old.remove();

    const [pr, cr, rr] = await Promise.all([
        supabaseClient.rpc("get_profile", { p_username: username }),
        supabaseClient.rpc("profile_counts", { p_username: username }),
        supabaseClient.rpc("profile_rooms", { p_username: username })
    ]);

    const p = pr.data && pr.data[0];
    if (pr.error || !p) {
        if (pr.error) console.error(pr.error);
        alert("No profile found for \"" + username + "\".\n(Purane messages, jo account banne se pehle ke hain, un ki profile nahi hoti.)");
        return;
    }
    const counts = (cr.data && cr.data[0]) || {};
    const rooms = rr.data || [];
    const isMe = myProfile && p.username === myProfile.username;

    const mk = (tag, cls, text) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    };

    const page = mk("div", "upage");
    page.id = "userProfilePage";

    const top = mk("div", "upg-top");
    const back = mk("button", "", "←");
    back.type = "button";
    back.addEventListener("click", () => page.remove());
    top.append(back, mk("strong", "", "@" + p.username));

    const head = mk("div", "upg-head");
    const pic = mk("div", "upg-pic");
    paintAvatar(pic, p.avatar_url, p.display_name || p.username);
    const meta = mk("div", "upg-meta");
    meta.appendChild(mk("div", "upg-nm", p.display_name || p.username));
    const stats = mk("div", "upg-stats");
    [[counts.friends || 0, "Friends"], [counts.rooms || 0, "Rooms"]].forEach(([n, l]) => {
        const d = mk("div");
        d.append(mk("strong", "", String(n)), mk("span", "", l));
        stats.appendChild(d);
    });
    meta.appendChild(stats);
    head.append(pic, meta);

    const bio = mk("p", "upg-bio", p.bio || "");

    const actions = mk("div", "upg-actions");
    const addBtn = (label, fn, main) => {
        const b = mk("button", main ? "main" : "", label);
        b.type = "button";
        b.addEventListener("click", fn);
        actions.appendChild(b);
    };
    const reload = () => { page.remove(); openUserProfile(p.username); };

    if (isMe) {
        addBtn("Edit profile", () => { page.remove(); $("editProfileBtn").click(); }, true);
    } else {
        if (p.friend_status === "none") {
            addBtn("Add friend", async () => {
                const { error: e } = await supabaseClient.rpc("send_friend_request", { p_username: p.username });
                if (e) { alert(e.message); return; }
                reload();
            }, true);
        } else if (p.friend_status === "outgoing") {
            addBtn("Request sent ▾", () => showSheet([
                ["Cancel request", async () => {
                    await supabaseClient.rpc("remove_friend", { p_id: p.fid });
                    reload();
                }, true],
                ["Cancel", () => {}]
            ]));
        } else if (p.friend_status === "incoming") {
            addBtn("Accept request", async () => {
                await supabaseClient.rpc("respond_friend_request", { p_id: p.fid, p_accept: true });
                reload();
            }, true);
        } else if (p.friend_status === "friend") {
            addBtn("Friends ✓ ▾", () => showSheet([
                ["Remove friend", async () => {
                    await supabaseClient.rpc("remove_friend", { p_id: p.fid });
                    reload();
                }, true],
                ["Cancel", () => {}]
            ]));
        }
        addBtn("Message", () => { page.remove(); messageFriend({ username: p.username }); });
    }

    const rt = mk("p", "myrooms-title", "ROOMS");
    const list = mk("div");
    if (!rooms.length) {
        list.appendChild(mk("p", "empty", "No rooms to show."));
    } else {
        rooms.forEach(r => {
            const card = mk("div", "room-card");
            const av = mk("div", "room-avatar");
            setAvatar(av, r.room_avatar);
            const text = mk("div", "room-card-text");
            const n = Number(r.member_count) || 0;
            text.append(
                mk("strong", "", "🔐 " + (r.room_name || "Private Room")),
                mk("span", "", n + (n === 1 ? " member" : " members"))
            );
            card.append(av, text);
            card.addEventListener("click", () => askRoomAccess(r, page));
            list.appendChild(card);
        });
    }

    page.append(top, head, bio, actions, rt, list);
    document.body.appendChild(page);
    // ---------- ROOM ACCESS (code + password) ----------
async function askRoomAccess(r, page) {
    const { data: mine } = await supabaseClient.rpc("my_rooms");
    const own = (mine || []).find(x => String(x.id) === String(r.room_id));
    if (own) {
        page.remove();
        currentRoom = own;
        currentUser = myProfile.username;
        openChat();
        return;
    }

    const old = $("roomAccessModal");
    if (old) old.remove();

    const m = document.createElement("div");
    m.id = "roomAccessModal";
    m.className = "modal";
    m.innerHTML =
        '<div class="modal-card">' +
        '<h3 id="raTitle"></h3>' +
        '<p class="subtitle">Enter the room code and password to join.</p>' +
        '<input id="raCode" type="text" placeholder="Room code" maxlength="8" autocapitalize="characters" autocomplete="off">' +
        '<input id="raPass" type="password" placeholder="Room password" autocomplete="off">' +
        '<p id="raMsg" class="auth-msg"></p>' +
        '<button type="button" id="raGo" class="primary-btn">Join room</button>' +
        '<button type="button" id="raCancel" class="secondary-btn">Cancel</button>' +
        '</div>';
    document.body.appendChild(m);
    $("raTitle").textContent = r.room_name || "Private Room";

    const msg = t => { $("raMsg").textContent = t || ""; };
    $("raCancel").addEventListener("click", () => m.remove());

    $("raGo").addEventListener("click", async () => {
        const code = $("raCode").value.trim().toUpperCase();
        const pw = $("raPass").value.trim();
        if (!code || !pw) return msg("Enter both code and password.");

        const { data, error } = await supabaseClient
            .rpc("join_room", { p_code: code, p_password: pw })
            .maybeSingle();

        if (error || !data || data.password !== pw || String(data.id) !== String(r.room_id)) {
            return msg("Wrong code or password.");
        }

        m.remove();
        page.remove();
        currentRoom = data;
        currentUser = myProfile.username;
        openChat();
    });
}
}
// ---------- AUTO REFRESH CHATS ----------
let chatsSig = "";
setInterval(async () => {
    if (!authUser || document.hidden) return;
    if ($("chatsPage").classList.contains("hidden")) return;
    if (document.querySelector(".modal, .sheet-backdrop")) return;
    const [a, b, c] = await Promise.all([
        supabaseClient.rpc("my_rooms"),
        supabaseClient.rpc("my_unread"),
        supabaseClient.rpc("my_dm_partners")
    ]);
    const sig = JSON.stringify([
        (a.data || []).map(r => r.id),
        b.data,
        (c.data || []).map(d => d.dm_status)
    ]);
    if (sig !== chatsSig) loadChats();
    chatsSig = sig;
}, 5000);
// ---------- NOTIFICATIONS ----------
async function refreshBell() {
    if (!authUser || !$("bellBadge")) return;
    const { data } = await supabaseClient.rpc("my_notif_count");
    const n = Number(data) || 0;
    const b = $("bellBadge");
    b.textContent = n > 99 ? "99+" : n;
    b.classList.toggle("hidden", !n);
}
setInterval(() => { if (!document.hidden) refreshBell(); }, 6000);

$("bellBtn").addEventListener("click", openNotifications);

async function openNotifications() {
    const old = $("notifModal");
    if (old) old.remove();

    const m = document.createElement("div");
    m.id = "notifModal";
    m.className = "modal";
    m.innerHTML =
        '<div class="modal-card friends-card">' +
        '<h3>Notifications</h3>' +
        '<div id="notifList"></div>' +
        '<button type="button" id="notifClose" class="secondary-btn">Close</button>' +
        '</div>';
    document.body.appendChild(m);
    $("notifClose").addEventListener("click", () => m.remove());
    m.addEventListener("click", e => { if (e.target === m) m.remove(); });

    const { data, error } = await supabaseClient.rpc("my_notifications");
    const box = $("notifList");
    if (error) {
        console.error(error);
        box.innerHTML = '<p class="empty">Could not load notifications.</p>';
        return;
    }
    const list = data || [];
    if (!list.length) {
        box.innerHTML = '<p class="empty">No notifications yet.</p>';
        return;
    }

    const texts = {
        friend_request: " sent you a friend request",
        friend_accepted: " accepted your friend request",
        dm_request: " sent you a message request",
        dm_accepted: " accepted your message request"
    };

    list.forEach(n => {
        const row = document.createElement("div");
        row.className = "member-row notif-row" + (n.is_read ? "" : " unread");
        row.style.cursor = "pointer";

        const av = document.createElement("div");
        av.className = "member-av";
        paintAvatar(av, n.avatar_url, n.display_name || n.username);

        const txt = document.createElement("div");
        txt.className = "member-text";
        const name = document.createElement("strong");
        name.textContent = n.display_name || n.username || "Someone";
        const sub = document.createElement("span");
        sub.textContent = (texts[n.kind] || "").trim() + " · " + timeAgo(n.created_at);
        txt.append(name, sub);
        row.append(av, txt);

        row.addEventListener("click", async () => {
            m.remove();
            if (n.kind === "dm_request") {
                openRequests();
            } else if (n.kind === "dm_accepted") {
                const { data: rs } = await supabaseClient.rpc("my_rooms");
                const room = (rs || []).find(r => String(r.id) === String(n.room_id));
                if (room) {
                    currentRoom = room;
                    currentUser = myProfile.username;
                    await loadDmMap();
                    openChat();
                }
            } else if (n.username) {
                openUserProfile(n.username);
            }
        });
        box.appendChild(row);
    });

    await supabaseClient.rpc("mark_notifs_read");
    refreshBell();
}
// ---------- FRIENDS POPUP (sirf list) ----------
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
        '<div id="frList"></div>' +
        '<button type="button" id="frFind" class="primary-btn">Find people</button>' +
        '<button type="button" id="frClose" class="secondary-btn">Close</button>' +
        '</div>';
    document.body.appendChild(m);

    const close = () => { m.remove(); loadStats(); };
    $("frClose").addEventListener("click", close);
    $("frFind").addEventListener("click", () => { m.remove(); showPage("searchPage"); });
    m.addEventListener("click", e => { if (e.target === m) close(); });

    renderFriends();
}

// ---------- SEARCH TAB ----------
(function () {
    const input = $("searchInput");
    const box = $("searchResults");
    let timer = null, token = 0;

    const buttonsFor = u => {
        if (u.friend_status === "friend") return [["Friends ✓", () => {}]];
        if (u.friend_status === "outgoing") return [["Sent", () => {}]];
        if (u.friend_status === "incoming") {
            return [["Accept", async () => {
                await supabaseClient.rpc("respond_friend_request", { p_id: u.fid, p_accept: true });
                run();
            }]];
        }
        return [["Add", async () => {
            const { error } = await supabaseClient.rpc("send_friend_request", { p_username: u.username });
            if (error) { alert(error.message); return; }
            run();
        }]];
    };

    async function run() {
        const q = input.value.trim().replace(/^@/, "");
        const my = ++token;
        if (!q) {
            box.innerHTML = '<p class="empty">Search people by name or username.</p>';
            return;
        }
        const { data, error } = await supabaseClient.rpc("search_users", { p_q: q });
        if (my !== token) return;
        box.innerHTML = "";
        if (error) {
            console.error(error);
            box.innerHTML = '<p class="empty">Search failed.</p>';
            return;
        }
        if (!data || !data.length) {
            box.innerHTML = '<p class="empty">No users found.</p>';
            return;
        }
        data.forEach(u => box.appendChild(friendRow(u, buttonsFor(u))));
    }

    input.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(run, 250);
    });
    run();
})();

// ---------- BLOCK / CLEARED HELPERS ----------
let blockedNames = new Set();
let clearedMap = {};

async function loadBlocks() {
    const { data } = await supabaseClient.rpc("my_blocks");
    blockedNames = new Set((data || []).map(b => b.username));
}

async function loadCleared() {
    if (!authUser) return;
    const { data } = await supabaseClient
        .from("room_members")
        .select("room_id,cleared_at")
        .eq("user_id", authUser.id);
    clearedMap = {};
    (data || []).forEach(r => {
        if (r.cleared_at) clearedMap[String(r.room_id)] = r.cleared_at;
    });
}

async function loadChatExtras() {
    await Promise.all([loadBlocks(), loadCleared()]);
}

async function toggleBlock(dm) {
    const was = blockedNames.has(dm.username);
    const name = dm.display_name || dm.username;
    const ask = was
        ? "Unblock " + name + "?"
        : "Block " + name + "?\nThey won't be able to message you, and you'll be unfriended.";
    if (!confirm(ask)) return;
    const { error } = await supabaseClient.rpc(was ? "unblock_user" : "block_user", {
        p_username: dm.username
    });
    if (error) { console.error(error); alert("Could not update block."); return; }
    await loadBlocks();
    if (!$("chatsPage").classList.contains("hidden")) loadChats();
}

// ---------- LONG PRESS ON CHAT ROW ----------
function attachRowMenu(row, room) {
    let timer = null, fired = false, sx = 0, sy = 0;
    const open = () => {
        fired = true;
        if (navigator.vibrate) navigator.vibrate(15);
        openChatRowMenu(room);
    };
    row.addEventListener("touchstart", e => {
        fired = false;
        sx = e.touches[0].clientX;
        sy = e.touches[0].clientY;
        timer = setTimeout(open, 550);
    }, { passive: true });
    row.addEventListener("touchmove", e => {
        if (Math.abs(e.touches[0].clientX - sx) > 10 || Math.abs(e.touches[0].clientY - sy) > 10) {
            clearTimeout(timer);
        }
    }, { passive: true });
    ["touchend", "touchcancel"].forEach(t =>
        row.addEventListener(t, () => clearTimeout(timer)));
    row.addEventListener("contextmenu", e => {
        e.preventDefault();
        clearTimeout(timer);
        if (!fired) open();
    });
    row.addEventListener("click", e => {
        if (fired) {
            e.stopImmediatePropagation();
            e.preventDefault();
            fired = false;
        }
    }, true);
}

function openChatRowMenu(room) {
    const dm = dmOf(room);
    const title = dm ? (dm.display_name || dm.username) : (room.room_name || "Room");
    if (dm) {
        showSheet([
            [blockedNames.has(dm.username) ? "Unblock" : "Block", () => toggleBlock(dm), true],
            ["Delete chat", async () => { await deleteChatForMe(room); loadChats(); }, true],
            ["Cancel", () => {}]
        ], title);
    } else {
        showSheet([
            ["Delete chat", async () => { await deleteChatForMe(room); loadChats(); }, true],
            ["Leave room", async () => { await leaveRoom(room); loadChats(); }, true],
            ["Cancel", () => {}]
        ], title);
    }
}

// ---------- CHAT ANDAR KA ⋮ MENU ----------
async function openChatMenu() {
    if (!currentRoom) return;

    const dm = dmOf(currentRoom);

    if (dm) {
        await loadBlocks();

        showSheet([
            ["Search messages", openSearch],
            ["Chat Theme", openChatThemePicker],
            [blockedNames.has(dm.username) ? "Unblock" : "Block", () => toggleBlock(dm), true],
            ["Delete chat", clearChatFromChat, true],
            ["Cancel", () => {}]
        ]);

        return;
    }

    showSheet([
        ["Room info", openRoomInfo],
        ["Members", showMembers],
        ["Search messages", openSearch],
        ["Chat Theme", openChatThemePicker],
        ["Delete chat", clearChatFromChat, true],
        ["Leave room", leaveFromChat, true],
        ["Cancel", () => {}]
    ]);
}

// ---------- DELETE CHAT (naya, server function se) ----------
async function deleteChatForMe(room) {
    if (!confirm("Delete this chat?\nThis removes the conversation only for you. Other members will still see it.")) return false;
    const { error } = await supabaseClient.rpc("clear_chat", { p_room: String(room.id) });
    if (error) {
        console.error(error);
        alert("Could not delete chat: " + error.message);
        return false;
    }
    if (typeof loadMyRooms === "function" && !$("profilePage").classList.contains("hidden")) loadMyRooms();
    return true;
}

async function clearChatFromChat() {
    if (!currentRoom) return;
    const ok = await deleteChatForMe(currentRoom);
    if (ok) $("messages").innerHTML = "";
}
// ---------- HIDE CLEARED CHATS ----------
let lastAtMap = {};

async function loadChatExtras() {
    await Promise.all([loadBlocks(), loadCleared()]);
    const { data } = await supabaseClient.rpc("my_room_stats");
    lastAtMap = {};
    (data || []).forEach(s => { lastAtMap[String(s.room_id)] = s.last_at; });
}

function isClearedEmpty(room) {
    const id = String(room.id);
    return !!clearedMap[id] && !lastAtMap[id];
}

async function clearChatFromChat() {
    if (!currentRoom) return;
    const ok = await deleteChatForMe(currentRoom);
    if (ok) {
        $("messages").innerHTML = "";
        $("leaveBtn").click();
    }
}
// ---------- ROOM TYPE (create page) ----------
let newRoomType = "text";

document.querySelectorAll(".tp").forEach(b => {
    b.addEventListener("click", () => {
        newRoomType = b.dataset.type;
        document.querySelectorAll(".tp").forEach(x => x.classList.toggle("active", x === b));
    });
});

async function applyNewRoomType(room) {
    const { error } = await supabaseClient.rpc("set_room_type", {
        p_id: String(room.id),
        p_type: newRoomType
    });
    if (error) console.error(error);
    room.room_type = newRoomType;
}

// ---------- ROOMS TAB (home) ----------
let homeTab = "text";
let homeData = [];

document.querySelectorAll(".rtab").forEach(b => {
    b.addEventListener("click", () => {
        homeTab = b.dataset.rt;
        document.querySelectorAll(".rtab").forEach(x => x.classList.toggle("active", x === b));
        renderHomeRooms();
    });
});

$("homeAvatar").addEventListener("click", () => showPage("profilePage"));
$("homeSearchBtn").addEventListener("click", () => showPage("searchPage"));

async function loadHomeRooms() {
    if (!authUser || !myProfile) return;

    // Show the profile picture right away
    paintAvatar($("homeAvatar"), myProfile.avatar_url, myProfile.display_name || myProfile.username);

    const [r1, r2, r3] = await Promise.all([
        supabaseClient.rpc("my_rooms"),
        supabaseClient.rpc("my_room_stats"),
        supabaseClient.rpc("my_room_types")
    ]);
    if (r1.error) {
        console.error(r1.error);
        $("homeRooms").innerHTML = '<p class="empty">Could not load rooms.</p>';
        return;
    }
    await loadDmMap();

    const types = {};
    (r3.data || []).forEach(t => { types[t.room_id] = t.room_type; });
    const stats = {};
    (r2.data || []).forEach(s => { stats[s.room_id] = s; });

    homeData = (r1.data || []).filter(r => !dmOf(r)).map(r => ({
        room: r,
        type: types[String(r.id)] || "text",
        members: Number((stats[String(r.id)] || {}).member_count) || 0
    }));
    renderHomeRooms();
}

function renderHomeRooms() {
    const box = $("homeRooms");
    const list = homeData.filter(x => homeTab === "all" || x.type === homeTab);
    box.innerHTML = "";

    if (!list.length) {
        const msg = homeTab === "voice" ? "No voice rooms yet. Create one!"
            : homeTab === "text" ? "No text rooms yet."
            : "No rooms yet.";
        box.innerHTML = '<p class="empty">' + msg + '</p>';
        return;
    }

    list.forEach(x => {
        const r = x.room;
        const card = document.createElement("div");
        card.className = "room-card";

        const av = document.createElement("div");
        av.className = "room-avatar";
        setAvatar(av, r.room_avatar);

        const text = document.createElement("div");
        text.className = "room-card-text";
        const title = document.createElement("strong");
        title.textContent = (x.type === "voice" ? "🎙️ " : "🔐 ") + (r.room_name || "Room " + r.room_code);
        const meta = document.createElement("span");
        meta.textContent = (x.type === "voice" ? "Voice Room" : "Text Room") +
            " • " + x.members + (x.members === 1 ? " member" : " members");
        text.append(title, meta);

        const open = document.createElement("button");
        open.type = "button";
        open.className = "room-open";
        open.textContent = "Open";

        card.append(av, text, open);
        card.addEventListener("click", () => openRoomFromProfile(r));
        box.appendChild(card);
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
// ================================
// SEND-ONLY MODE
// Overrides the older send-mode functions above
// ================================
function setTypingMode(on) {
    $("messageForm").classList.toggle("has-text", !!on);
}
function syncSendMode() { setTypingMode(true); }
function exitTypingMode() { setTypingMode(false); }

$("messageInput").addEventListener("focus", () => setTypingMode(true));
$("messageInput").addEventListener("blur", () => setTypingMode(false));

// Stay in send-only mode while the input is focused and the user types
$("messageInput").addEventListener("input", () => {
    if (document.activeElement === $("messageInput")) setTypingMode(true);
});

// Keep focus (and the keyboard) when the send button is pressed
const _sendBtn2 = document.querySelector(".send-btn");
if (_sendBtn2) _sendBtn2.addEventListener("mousedown", e => e.preventDefault());
// ================================
// KEYBOARD-AWARE SEND MODE
// Leaves send-only mode when the keyboard closes
// ================================
(function () {
    const input = $("messageInput");
    const vv = window.visualViewport;
    let maxH = vv ? vv.height : window.innerHeight;

    function currentH() {
        return vv ? vv.height : window.innerHeight;
    }

    function onViewportChange() {
        const h = currentH();
        if (h > maxH) maxH = h;
        // Keyboard is closed when the viewport is back to (almost) full height
        if (document.activeElement === input && h >= maxH - 80) {
            input.blur();
        }
    }

    if (vv) vv.addEventListener("resize", onViewportChange);
    window.addEventListener("resize", onViewportChange);

    // Tapping the messages area closes the keyboard
    $("messages").addEventListener("pointerdown", () => {
        if (document.activeElement === input) input.blur();
    });

    // Safety net: if the input is not focused, always show all buttons
    setInterval(() => {
        if (document.activeElement !== input) setTypingMode(false);
    }, 600);
})();
// ================================
// VOICE ROOM (seats, presence, chat)
// Audio is added in the next step
// ================================
const SEAT_COUNT = 9;
let vChannel = null;
let vRoom = null;
let vHost = null;
let vState = null;

function roomTypeOf(room) {
    if (room && room.room_type) return room.room_type;
    const t = typeof homeData !== "undefined" &&
        homeData.find(x => String(x.room.id) === String(room && room.id));
    return t ? t.type : "text";
}

// Open voice rooms in the voice page, everything else as before
const _openChatVoice = window.openChat;
window.openChat = async function () {
    if (currentRoom && roomTypeOf(currentRoom) === "voice") return openVoiceRoom();
    return _openChatVoice();
};

function isHost() {
    return !!(vState && vHost && vState.username === vHost);
}

function vTrack() {
    if (vChannel && vState) vChannel.track(vState);
}

function buildVoicePage() {
    if ($("voicePage")) return;
    const p = document.createElement("main");
    p.id = "voicePage";
    p.className = "chat-page vpage hidden";
    p.innerHTML =
        '<header class="v-top">' +
            '<button type="button" id="vBack" class="hdr-btn"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"></path></svg></button>' +
            '<strong>Voice Room</strong>' +
            '<button type="button" id="vMenu" class="hdr-btn"><svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.5"></circle><circle cx="12" cy="12" r="1.5"></circle><circle cx="12" cy="19" r="1.5"></circle></svg></button>' +
        '</header>' +
        '<div class="v-card">' +
            '<div id="vAvatar" class="room-avatar"></div>' +
            '<div class="v-card-text"><strong id="vName"></strong><span id="vMeta"></span></div>' +
        '</div>' +
        '<div class="v-stats"><span id="vCount"></span><span class="v-live">● Live</span></div>' +
        '<div id="vSeats" class="v-seats"></div>' +
        '<div class="v-controls">' +
            '<button type="button" id="vHand"><span>✋</span>Raise hand</button>' +
            '<button type="button" id="vMic" class="v-mic">' +
                '<svg viewBox="0 0 24 24"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z"></path><path d="M19 11a7 7 0 0 1-14 0"></path><path d="M12 18v4"></path></svg>' +
                '<small id="vMicLbl">Unmute</small>' +
            '</button>' +
            '<button type="button" id="vLeave"><span>🚪</span>Leave</button>' +
        '</div>' +
        '<div id="vChat" class="v-chat"></div>' +
        '<form id="vForm" class="v-form">' +
            '<input id="vInput" type="text" placeholder="Type a message..." autocomplete="off">' +
            '<button type="submit" class="send-btn" aria-label="Send"><svg viewBox="0 0 24 24"><path d="M21 3L10.5 13.5"></path><path d="M21 3L15 21L10.5 13.5L3 9L21 3Z"></path></svg></button>' +
        '</form>';
    document.body.appendChild(p);

    $("vBack").addEventListener("click", closeVoice);
    $("vLeave").addEventListener("click", async () => {
    const sure = confirm(
        "Leave the Voice Room?\n\nYou can join again anytime."
    );

    if (!sure) return;

    await closeVoice();
});
    $("vMenu").addEventListener("click", openVoiceMenu);
    $("vMic").addEventListener("click", toggleMic);
    $("vHand").addEventListener("click", () => {
        if (!vState) return;
        vState.hand = !vState.hand;
        vTrack();
        renderVoice();
    });
    $("vForm").addEventListener("submit", sendVoiceMessage);
}

async function openVoiceRoom() {
    const room = currentRoom;
    if (!room || !myProfile) return;

    // Make sure the user is a member of this room
    if (authUser) {
        await supabaseClient.from("room_members").upsert(
            { room_id: room.id, user_id: authUser.id },
            { onConflict: "room_id,user_id", ignoreDuplicates: true }
        );
    }

    vRoom = room;
    currentUser = myProfile.username;
    buildVoicePage();
    vState = {
        username: myProfile.username,
        name: myProfile.display_name || myProfile.username,
        avatar: myProfile.avatar_url || null,
        seat: null,
        seatAt: 0,
        muted: true,
        hand: false
    };

    showPage("voicePage");
    $("vName").textContent = room.room_name || "Voice Room";
    setAvatar($("vAvatar"), room.room_avatar);
    $("vMeta").textContent = "Voice Room";
    $("vChat").innerHTML = "";

    if (vChannel) {
        await supabaseClient.removeChannel(vChannel);
        vChannel = null;
    }

    vChannel = supabaseClient.channel("voice-" + room.id, {
        config: { presence: { key: vState.username }, broadcast: { self: false } }
    });

    vChannel
        .on("presence", { event: "sync" }, renderVoice)
        .on("broadcast", { event: "kick" }, p => {
            if (vState && p.payload.username === vState.username && vState.seat !== null) leaveSeat();
        })
        .on("broadcast", { event: "mute_all" }, () => {
            if (vState && !isHost()) {
                vState.muted = true;
                vTrack();
                renderVoice();
            }
        })
        .on("postgres_changes",
            { event: "INSERT", schema: "public", table: "messages", filter: `room_id=eq.${room.id}` },
            async payload => {
                if (!vRoom) return;
                await loadAvatars([payload.new.username]);
                addVoiceMsg(payload.new);
                if (payload.new.username !== vState.username) markVoiceSeen();
            })
        .subscribe(async status => {
            if (status === "SUBSCRIBED") await vChannel.track(vState);
        });

    const [h, mem] = await Promise.all([
        supabaseClient.rpc("room_host", { p_room: String(room.id) }),
        supabaseClient.rpc("room_member_list", { p_room: String(room.id) })
    ]);
    vHost = h.data || null;
    const n = (mem.data || []).length;
    $("vMeta").textContent = "Voice Room • " + n + (n === 1 ? " member" : " members");

    renderVoice();
    await loadVoiceChat();
    markVoiceSeen();
}

async function closeVoice() {
    if (vChannel) {
        try { await vChannel.untrack(); } catch (e) {}
        await supabaseClient.removeChannel(vChannel);
        vChannel = null;
    }
    vRoom = null;
    vState = null;
    currentRoom = null;
    currentUser = null;
    showPage("homePage");
}

function vUsers() {
    const st = vChannel ? vChannel.presenceState() : {};
    const list = [];
    Object.keys(st).forEach(k => {
        const metas = st[k];
        if (metas && metas.length) list.push(metas[metas.length - 1]);
    });
    return list;
}

function renderVoice() {
    if (!vRoom || !vState || !$("vSeats")) return;
    const me = vState.username;

    // Use my local state for myself so my own changes show instantly
    const users = vUsers().filter(u => u.username !== me);
    users.push(vState);

    // If two people took the same seat, the earliest one keeps it
    const bySeat = {};
    users.forEach(u => {
        if (u.seat === null || u.seat === undefined) return;
        const cur = bySeat[u.seat];
        const a = u.seatAt || 0;
        const b = cur ? (cur.seatAt || 0) : 0;
        if (!cur || a < b || (a === b && u.username < cur.username)) bySeat[u.seat] = u;
    });
    if (vState.seat !== null && bySeat[vState.seat] && bySeat[vState.seat].username !== me) {
        vState.seat = null;
        vState.seatAt = 0;
        vState.muted = true;
        vTrack();
    }

    $("vCount").textContent = "👥 " + users.length + (users.length === 1 ? " person" : " people");

    const grid = $("vSeats");
    grid.innerHTML = "";
    for (let i = 0; i < SEAT_COUNT; i++) {
        const u = bySeat[i];
        const cell = document.createElement("div");
        cell.className = "v-seat";
        const circle = document.createElement("div");
        circle.className = "v-circle";
        const label = document.createElement("span");
        label.className = "v-label";
        const sub = document.createElement("span");
        sub.className = "v-sub";

        if (u) {
            paintAvatar(circle, u.avatar, u.name || u.username);
            if (u.username === vHost) circle.classList.add("host");
            const badge = document.createElement("i");
            badge.className = "v-badge " + (u.muted ? "off" : "on");
            badge.textContent = u.muted ? "🔇" : "🎙️";
            circle.appendChild(badge);
            if (u.hand) {
                const hand = document.createElement("i");
                hand.className = "v-hand";
                hand.textContent = "✋";
                circle.appendChild(hand);
            }
            label.textContent = u.name || u.username;
            sub.textContent = u.username === vHost ? "Host"
                : u.hand ? "Hand raised"
                : u.muted ? "Muted" : "Mic on";
        } else {
            circle.classList.add("empty");
            circle.textContent = "+";
            label.textContent = "Take Seat";
        }

        cell.append(circle, label, sub);
        cell.addEventListener("click", () => onSeatTap(i, u));
        grid.appendChild(cell);
    }

    const onSeat = vState.seat !== null;
    $("vMic").classList.toggle("live", onSeat && !vState.muted);
    $("vMicLbl").textContent = onSeat && !vState.muted ? "Mute" : "Unmute";
    $("vHand").classList.toggle("active", !!vState.hand);
}

function takeSeat(i) {
    vState.seat = i;
    vState.seatAt = Date.now();
    vState.muted = true;
    vTrack();
    renderVoice();
}

function leaveSeat() {
    if (!vState) return;
    vState.seat = null;
    vState.seatAt = 0;
    vState.muted = true;
    vTrack();
    renderVoice();
}

function toggleMic() {
    if (!vState) return;
    if (vState.seat === null) {
        alert("Take a seat first to use the mic.");
        return;
    }
    vState.muted = !vState.muted;
    vTrack();
    renderVoice();
}

function onSeatTap(i, u) {
    if (!u) { takeSeat(i); return; }

    if (u.username === vState.username) {
        showSheet([
            [vState.muted ? "Unmute mic" : "Mute mic", toggleMic],
            ["Leave seat", leaveSeat, true],
            ["Cancel", () => {}]
        ], "My seat");
        return;
    }

    const items = [["View profile", () => openUserProfile(u.username)]];
    if (isHost()) {
        items.push(["Remove from seat", () => {
            vChannel.send({ type: "broadcast", event: "kick", payload: { username: u.username } });
        }, true]);
    }
    items.push(["Cancel", () => {}]);
    showSheet(items, u.name || u.username);
}

function openVoiceMenu() {
    const items = [];
    if (isHost()) {
        items.push(["Mute everyone", () => {
            vChannel.send({ type: "broadcast", event: "mute_all", payload: {} });
        }]);
    }
    items.push(["Room info", openRoomInfo]);
    items.push(["Members", showMembers]);
    if (isHost()) items.push(["Edit name & photo", openEditRoom]);
    items.push(["Leave room permanently", leaveVoiceMembership, true]);
    items.push(["Cancel", () => {}]);
    showSheet(items, "Room menu");
}

async function leaveVoiceMembership() {
    if (!vRoom) return;
    if (!confirm("Leave this room?\nYou won't be able to access it unless you join again.")) return;
    const { data, error } = await supabaseClient
        .from("room_members")
        .delete()
        .eq("room_id", vRoom.id)
        .eq("user_id", authUser.id)
        .select();
    if (error || !data || !data.length) {
        console.error(error);
        alert("Could not leave room.");
        return;
    }
    await closeVoice();
}

// ---------- Voice room chat ----------
async function loadVoiceChat() {
    if (!vRoom) return;
    const { data } = await supabaseClient
        .from("messages")
        .select("*")
        .eq("room_id", vRoom.id)
        .order("created_at", { ascending: false })
        .limit(30);
    const list = (data || []).reverse();
    await loadAvatars(list.map(m => m.username));
    list.forEach(addVoiceMsg);
}

function addVoiceMsg(m) {
    const box = $("vChat");
    if (!box || !m) return;
    if (m.id && box.querySelector('[data-id="' + m.id + '"]')) return;

    const p = avatarCache[m.username];
    const row = document.createElement("div");
    row.className = "v-msg";
    if (m.id) row.dataset.id = m.id;

    const av = document.createElement("div");
    av.className = "v-msg-av";
    paintAvatar(av, p && p.avatar_url, (p && p.display_name) || m.username);
    av.addEventListener("click", () => openUserProfile(m.username));

    const body = document.createElement("div");
    body.className = "v-msg-body";
    const nm = document.createElement("strong");
    nm.textContent = (p && p.display_name) || m.username;
    const tx = document.createElement("span");
    tx.textContent = m.audio_url ? "🎤 Voice message"
        : m.media_url ? "📷 Photo/Video"
        : (m.message || "");
    body.append(nm, tx);

    row.append(av, body);
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
}

async function sendVoiceMessage(e) {
    e.preventDefault();
    const input = $("vInput");
    const text = input.value.trim();
    if (!text || !vRoom) return;
    input.value = "";
    const { error } = await supabaseClient.from("messages").insert({
        room_id: vRoom.id,
        username: myProfile.username,
        message: text
    });
    if (error) {
        console.error(error);
        alert("Message could not be sent.");
        input.value = text;
    }
}

function markVoiceSeen() {
    if (!vRoom || !myProfile) return;
    supabaseClient.rpc("mark_seen", {
        p_room: String(vRoom.id),
        p_user: myProfile.username
    });
}
// ================================
// VOICE ROOM v2: icons, speaking glow, compact layout, leave fix
// These definitions override the earlier ones above
// ================================
const VIC = {
    mic: '<svg viewBox="0 0 24 24"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></svg>',
    micOff: '<svg viewBox="0 0 24 24"><path d="M2 2l20 20"/><path d="M18.9 13.2A7 7 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.3V5a3 3 0 0 0-5.7-1.3"/><path d="M9 9v3a3 3 0 0 0 5.1 2.1"/><path d="M12 19v3"/></svg>',
    hand: '<svg viewBox="0 0 24 24"><path d="M18 11V6a2 2 0 0 0-4 0"/><path d="M14 10V4a2 2 0 0 0-4 0v2"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>',
    leave: '<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>'
};

function buildVoicePage() {
    if ($("voicePage")) return;
    const p = document.createElement("main");
    p.id = "voicePage";
    p.className = "chat-page vpage hidden";
    p.innerHTML =
        '<header class="v-top">' +
            '<button type="button" id="vBack" class="hdr-btn"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"></path></svg></button>' +
            '<div class="v-head">' +
                '<div id="vAvatar" class="room-avatar"></div>' +
                '<div class="v-card-text"><strong id="vName"></strong><span id="vMeta"></span></div>' +
            '</div>' +
            '<button type="button" id="vMenu" class="hdr-btn"><svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.5"></circle><circle cx="12" cy="12" r="1.5"></circle><circle cx="12" cy="19" r="1.5"></circle></svg></button>' +
        '</header>' +
        '<div class="v-stats"><span id="vCount"></span><span class="v-live">● Live</span></div>' +
        '<div id="vSeats" class="v-seats"></div>' +
        '<div class="v-controls">' +
            '<button type="button" id="vHand" class="v-cbtn"><span class="v-ic">' + VIC.hand + '</span><small>Raise hand</small></button>' +
            '<button type="button" id="vMic" class="v-cbtn mic"><span class="v-ic" id="vMicIc">' + VIC.micOff + '</span><small id="vMicLbl">Unmute</small></button>' +
            '<button type="button" id="vLeave" class="v-cbtn"><span class="v-ic">' + VIC.leave + '</span><small>Leave</small></button>' +
        '</div>' +
        '<div id="vChat" class="v-chat"></div>' +
        '<form id="vForm" class="v-form">' +
            '<input id="vInput" type="text" placeholder="Type a message..." autocomplete="off">' +
            '<button type="submit" class="send-btn" aria-label="Send"><svg viewBox="0 0 24 24"><path d="M21 3L10.5 13.5"></path><path d="M21 3L15 21L10.5 13.5L3 9L21 3Z"></path></svg></button>' +
        '</form>';
    document.body.appendChild(p);

    $("vBack").addEventListener("click", closeVoice);
    $("vLeave").addEventListener("click", closeVoice);
    $("vMenu").addEventListener("click", openVoiceMenu);
    $("vMic").addEventListener("click", toggleMic);
    $("vHand").addEventListener("click", () => {
        if (!vState) return;
        vState.hand = !vState.hand;
        vTrack();
        renderVoice();
    });
    $("vForm").addEventListener("submit", sendVoiceMessage);
}

function renderVoice() {
    if (!vRoom || !vState || !$("vSeats")) return;
    const me = vState.username;

    // Use my local state for myself so my own changes show instantly
    const users = vUsers().filter(u => u.username !== me);
    users.push(vState);

    // If two people took the same seat, the earliest one keeps it
    const bySeat = {};
    users.forEach(u => {
        if (u.seat === null || u.seat === undefined) return;
        const cur = bySeat[u.seat];
        const a = u.seatAt || 0;
        const b = cur ? (cur.seatAt || 0) : 0;
        if (!cur || a < b || (a === b && u.username < cur.username)) bySeat[u.seat] = u;
    });
    if (vState.seat !== null && bySeat[vState.seat] && bySeat[vState.seat].username !== me) {
        vState.seat = null;
        vState.seatAt = 0;
        vState.muted = true;
        vState.speaking = false;
        vTrack();
    }

    $("vCount").textContent = users.length + (users.length === 1 ? " person" : " people");

    const grid = $("vSeats");
    grid.innerHTML = "";
    for (let i = 0; i < SEAT_COUNT; i++) {
        const u = bySeat[i];
        const cell = document.createElement("div");
        cell.className = "v-seat";
        const circle = document.createElement("div");
        circle.className = "v-circle";
        const label = document.createElement("span");
        label.className = "v-label";
        const sub = document.createElement("span");
        sub.className = "v-sub";

        if (u) {
            paintAvatar(circle, u.avatar, u.name || u.username);
            if (u.username === vHost) circle.classList.add("host");
            if (u.speaking && !u.muted) circle.classList.add("speaking");
            if (u.muted) {
                const b = document.createElement("i");
                b.className = "v-badge";
                b.innerHTML = VIC.micOff;
                circle.appendChild(b);
            }
            if (u.hand) {
                const h = document.createElement("i");
                h.className = "v-hand";
                h.innerHTML = VIC.hand;
                circle.appendChild(h);
            }
            label.textContent = u.name || u.username;
            sub.textContent = u.username === vHost ? "Host"
                : u.hand ? "Hand raised"
                : (u.speaking && !u.muted) ? "Speaking"
                : u.muted ? "Muted" : "";
        } else {
            circle.classList.add("empty");
            circle.textContent = "+";
            label.textContent = "Take Seat";
        }

        cell.append(circle, label, sub);
        cell.addEventListener("click", () => onSeatTap(i, u));
        grid.appendChild(cell);
    }

    const live = vState.seat !== null && !vState.muted;
    $("vMic").classList.toggle("live", live);
    $("vMicIc").innerHTML = live ? VIC.mic : VIC.micOff;
    $("vMicLbl").textContent = live ? "Mute" : "Unmute";
    $("vHand").classList.toggle("active", !!vState.hand);
}

// ---------- Mic level detection (drives the speaking glow) ----------
let vMicStream = null;
let vAudioCtx = null;
let vMicTimer = null;
let vLastLoud = 0;

async function startMic() {
    if (vMicStream) return true;
    try {
        vMicStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
    } catch (e) {
        console.error(e);
        alert("Microphone permission is required.");
        return false;
    }

    const AC = window.AudioContext || window.webkitAudioContext;
    vAudioCtx = new AC();
    if (vAudioCtx.resume) vAudioCtx.resume();
    const src = vAudioCtx.createMediaStreamSource(vMicStream);
    const analyser = vAudioCtx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);

    vMicTimer = setInterval(() => {
        // Stop listening as soon as the user is muted or has left the seat
        if (!vState || vState.muted || vState.seat === null) { stopMic(); return; }
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        const now = Date.now();
        if (rms > 0.04) vLastLoud = now;
        const speaking = now - vLastLoud < 500;
        if (speaking !== !!vState.speaking) {
            vState.speaking = speaking;
            vTrack();
            renderVoice();
        }
    }, 120);
    return true;
}

function stopMic() {
    clearInterval(vMicTimer);
    vMicTimer = null;
    if (vMicStream) {
        vMicStream.getTracks().forEach(t => t.stop());
        vMicStream = null;
    }
    if (vAudioCtx) {
        try { vAudioCtx.close(); } catch (e) {}
        vAudioCtx = null;
    }
    if (vState && vState.speaking) {
        vState.speaking = false;
        vTrack();
        renderVoice();
    }
}

async function toggleMic() {
    if (!vState) return;
    if (vState.seat === null) {
        alert("Take a seat first to use the mic.");
        return;
    }
    if (vState.muted) {
        const ok = await startMic();
        if (!ok) return;
        vState.muted = false;
    } else {
        vState.muted = true;
    }
    vTrack();
    renderVoice();
}

async function closeVoice() {
    stopMic();
    if (vChannel) {
        try { await vChannel.untrack(); } catch (e) {}
        await supabaseClient.removeChannel(vChannel);
        vChannel = null;
    }
    vRoom = null;
    vState = null;
    currentRoom = null;
    currentUser = null;
    showPage("homePage");
}

// ---------- Leave room (server function, replaces the older versions) ----------
async function leaveRoom(room) {
    if (!confirm("Leave this room?\nYou won't be able to access it unless you join again.")) return false;
    const { error } = await supabaseClient.rpc("leave_room", { p_room: String(room.id) });
    if (error) {
        console.error(error);
        alert("Could not leave room: " + error.message);
        return false;
    }
    if (typeof loadMyRooms === "function") loadMyRooms();
    if (typeof loadStats === "function") loadStats();
    if (typeof loadHomeRooms === "function") loadHomeRooms();
    return true;
}

async function leaveFromChat() {
    if (!currentRoom) return;
    const ok = await leaveRoom(currentRoom);
    if (ok) $("leaveBtn").click();
}

async function leaveVoiceMembership() {
    if (!vRoom) return;
    const ok = await leaveRoom(vRoom);
    if (ok) await closeVoice();
}
// ================================
// GAMES + ROOM AI
// ================================
const AI_NAME = "mochi";       // change the AI's name here (and in the edge function secret AI_NAME)
const AI_CHIME_RATE = 0.04;    // chance the AI chimes in unprompted (0 = never)
const AI_MENTION_RE = new RegExp("(^|\\s)@" + AI_NAME + "\\b", "i");
const AI_AVATAR = "data:image/svg+xml," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="50" fill="#F8E8ED"/>' +
    '<ellipse cx="50" cy="56" rx="32" ry="26" fill="#fff" stroke="#D98FA8" stroke-width="3"/>' +
    '<circle cx="39" cy="54" r="3.5" fill="#4B3439"/><circle cx="61" cy="54" r="3.5" fill="#4B3439"/>' +
    '<path d="M44 63q6 6 12 0" fill="none" stroke="#4B3439" stroke-width="3" stroke-linecap="round"/>' +
    '<circle cx="32" cy="62" r="4" fill="#F4B6C8"/><circle cx="68" cy="62" r="4" fill="#F4B6C8"/>' +
    '<path d="M50 30q-4-10 6-14" fill="none" stroke="#9BBF8F" stroke-width="4" stroke-linecap="round"/></svg>'
);
avatarCache[AI_NAME] = { username: AI_NAME, display_name: AI_NAME, avatar_url: AI_AVATAR };

function isAI(u) { return String(u || "").toLowerCase() === AI_NAME.toLowerCase(); }

// ---------- tiny helpers ----------
function gEl(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}
function gBtn(label, cls, fn) {
    const b = gEl("button", cls, label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
}
function gToast(msg) {
    const t = gEl("div", "g-toast", msg);
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
}
function gMe() {
    return { u: myProfile.username, n: myProfile.display_name || myProfile.username, a: myProfile.avatar_url || null };
}
function gPlayer(s, u) { return s.players.find(p => p.u === u) || { u, n: u, a: null }; }
function gLine(arr, n) { return arr[Math.floor(Math.random() * arr.length)].replace("{n}", n || ""); }

// ---------- built-in content (used when the AI is offline) ----------
const TOD_TRUTHS = [
    "Last time kis ko ghost kiya tha, aur kyun? Honest raho 👀",
    "Phone ki sab se embarrassing search kya hai? Delete karne se pehle batao 😭",
    "Kis ek banday ka message tum jaan boojh ke seen karke ignore karte ho?",
    "Tumhari sab se cringe Instagram story ya post konsi thi?",
    "Agar aaj raat crush ka 'hi' aa jaye, tumhara pehla reaction kya hoga?",
    "Kabhi galat banday ko message bhej diya? Kya likha tha?",
    "Apne andar ke 3 red flags batao, no lies 😌",
    "Ex ke baare mein ek cheez jo yaad karke ab bhi cringe aati hai?",
    "Is room mein kis ke saath tumhari sab se zyada gossip hoti hai?",
    "Sab se bara jhoot kya bola jo kabhi pakda nahi gaya?",
    "Tumhari secret guilty-pleasure playlist ka sab se embarrassing gaana kaunsa hai?",
    "Kis cheez par tum ne itni acting ki ke Oscar banta tha?"
];
const TOD_DARES = [
    "Apne last 5 emojis ko jod kar ek mini story banao aur voice note mein sunao.",
    "Agle 3 messages sirf Shakespeare style mein likho 🎭",
    "Kisi ek member ko 30 second ka Oscar-winning compliment do.",
    "Agle 5 minute har message ke end mein 'bestie' lagao.",
    "Ek rap likho jisme room ke sab members ka naam ho, aur voice note bhejo.",
    "Apni gallery ka 7th photo bina dikhaye describe karo, aur sab guess karein.",
    "20 second khud ko pep talk do aur voice note bhejo.",
    "Ek cheesy pickup line likho (kisi ka naam liye bagair) aur group se rate karwao.",
    "Kisi member ke liye 2 line ki pyaar bhari roast likho.",
    "Agle 3 messages sirf emojis mein bhejo.",
    "Apne sab se purane gaane ko 3 line mein defend karo.",
    "Apni sab se ajeeb talent 10 second ke voice note mein dikhao."
];
const TOD_REACT = [
    "Bruh 😭 ye toh bohot cringe tha, but respect.",
    "Okay drama king/queen, noted 👀",
    "Rating: 7/10, thora aur chaos chahiye tha 😌",
    "Plot twist ke liye 10/10 🔥",
    "Hmm... suspicious. Jhoot toh nahi bol rahe? 🤨",
    "Ye answer maine save kar liya, kal kaam aayega 😈"
];
const TOD_LINES = {
    turn: ["Alright {n}... this is gonna be fun 😏", "{n}, tumhari baari. Bhaagna mat 👀", "Chalo {n}, drama ka time 🍿"],
    prompt: ["Oof... soch samajh ke jawab dena 👀", "No excuses, bestie 😈", "Ye toh spicy hai 🌶️"]
};

// ---------- AI profile card ----------
const _openUserProfile = openUserProfile;
openUserProfile = function (u) {
    if (isAI(u)) {
        showSheet([["Close", () => {}]], AI_NAME + " (room ki AI dost). @" + AI_NAME + " likh kar bulao");
        return;
    }
    return _openUserProfile(u);
};

// ---------- AI in chat (mentions + rare unprompted replies) ----------
const aiHandled = new Set();

async function mochiCall(body) {
    const { data, error } = await supabaseClient.functions.invoke("mochi", { body });
    if (error || !data || data.error) {
        throw new Error((error && error.message) || (data && data.error) || "mochi failed");
    }
    return data;
}

async function gCompactGame(room) {
    try {
        const row = await gGet(room);
        const s = row && row.state;
        if (!s || s.status !== "playing") return null;
        return {
            players: s.players.map(p => p.u),
            turn: s.turn, phase: s.phase, kind: s.choice,
            prompt: s.prompt, answer: s.answer
        };
    } catch (e) { return null; }
}

async function askMochi(m, mode) {
    const room = currentRoom;
    if (!room) return;
    try {
        const game = await gCompactGame(room);
        const d = await mochiCall({ mode, room_id: String(room.id), message_id: m.id, game });
        if (d.action && game) await gApplyAIAction(room, d.action);
    } catch (e) {
        console.error("mochi:", e);
        if (mode === "chat") gToast(AI_NAME + " abhi offline hai");
    }
}

function aiHook(m) {
    if (!m || !m.id || !myProfile) return;
    if (isAI(m.username)) { gShowAiLine(m); return; }
    if (m.username !== myProfile.username || aiHandled.has(m.id)) return;
    if (Date.now() - new Date(m.created_at).getTime() > 60000) return;
    const text = m.message || "";
    if (AI_MENTION_RE.test(text)) {
        aiHandled.add(m.id);
        askMochi(m, "chat");
    } else if (AI_CHIME_RATE > 0 && text.length >= 25 && Math.random() < AI_CHIME_RATE) {
        aiHandled.add(m.id);
        askMochi(m, "organic");
    }
}

// Hook both chat renderers (text room + voice room chat) without editing them
const _displayMessage = displayMessage;
displayMessage = function (m) { _displayMessage(m); try { aiHook(m); } catch (e) { console.error(e); } };
const _addVoiceMsg = addVoiceMsg;
addVoiceMsg = function (m) { _addVoiceMsg(m); try { aiHook(m); } catch (e) { console.error(e); } };

// ---------- games state (shared through the room_games table) ----------
const G = { room: null, rev: 0, state: null, loaded: false, busy: false, thinking: "",
            view: "menu", ch: null, poll: null, draft: "", aiText: "", aiTimer: null };

async function gGet(room) {
    const { data, error } = await supabaseClient.rpc("game_get", { p_room: String(room.id) });
    if (error) { console.error(error); return null; }
    const r = data && data[0];
    return r ? { state: r.state, rev: r.rev } : { state: null, rev: 0 };
}
async function gSet(room, state, rev) {
    const { data, error } = await supabaseClient.rpc("game_set", {
        p_room: String(room.id), p_game: "tod", p_state: state, p_expected: rev
    });
    if (error) { console.error(error); return false; }
    return !!data;
}

function gApplyRow(row, force) {
    if (!row) return;
    if (G.loaded && !force && row.rev === G.rev) return;
    if (G.loaded && !force && row.rev < G.rev) return;
    G.loaded = true;
    G.state = row.state && row.state.status ? row.state : null;
    G.rev = row.rev;
    if (!G.thinking) renderToD();
}

// Read-modify-write with a revision check so two taps at once never clash
async function gMutate(fn) {
    if (G.busy) return;
    G.busy = true;
    try {
        const row = await gGet(G.room);
        if (!row) return;
        const cur = row.state && row.state.status ? JSON.parse(JSON.stringify(row.state)) : null;
        const next = fn(cur);
        if (!next) { gApplyRow(row, true); return; }
        const ok = await gSet(G.room, next, row.rev);
        if (ok) { G.state = next; G.rev = row.rev + 1; }
        else { gApplyRow(await gGet(G.room), true); gToast("Kisi aur ne pehle move kar diya, dobara try karo"); }
    } finally {
        G.busy = false;
        renderToD();
    }
}

async function gThink(label, fn) {
    G.thinking = label;
    renderToD();
    try { await fn(); } finally { G.thinking = ""; renderToD(); }
}

function gAdvance(s) {
    s.counts = s.counts || {};
    if (s.turn) s.counts[s.turn] = (s.counts[s.turn] || 0) + 1;
    const others = s.players.filter(p => p.u !== s.turn);
    const pool = others.length ? others : s.players;
    const min = Math.min(...pool.map(p => s.counts[p.u] || 0));
    const cand = pool.filter(p => (s.counts[p.u] || 0) === min);
    const nxt = cand[Math.floor(Math.random() * cand.length)];
    s.turn = nxt.u;
    s.phase = "choose";
    s.choice = null; s.prompt = null; s.promptBy = null; s.answer = null;
    s.round = (s.round || 0) + 1;
    s.say = AI_NAME + " has chosen " + nxt.n + " 👑";
}

function gSetPrompt(x, kind, text, by) {
    x.phase = "prompt";
    x.choice = kind;
    x.prompt = String(text).slice(0, 300);
    x.promptBy = by;
    x.answer = null;
    x.say = gLine(TOD_LINES.prompt);
    x.history = [...(x.history || []), x.prompt].slice(-12);
}

// ---------- game actions ----------
function gCreate() {
    gMutate(() => ({ game: "tod", status: "lobby", host: myProfile.username, players: [gMe()],
                     counts: {}, history: [], round: 0, say: "" }));
}
function gJoin() {
    gMutate(x => {
        if (!x || (x.status !== "lobby" && x.status !== "playing")) return null;
        if (!x.players.some(p => p.u === myProfile.username)) x.players.push(gMe());
        return x;
    });
}
function gStart() {
    gMutate(x => {
        if (!x || x.status !== "lobby" || x.host !== myProfile.username || x.players.length < 2) return null;
        const first = x.players[Math.floor(Math.random() * x.players.length)];
        x.status = "playing"; x.turn = first.u; x.phase = "choose"; x.counts = {}; x.round = 1;
        x.say = gLine(TOD_LINES.turn, first.n);
        return x;
    });
}
function gEnd() {
    gMutate(x => {
        if (!x || x.host !== myProfile.username) return null;
        x.status = "ended";
        return x;
    });
}
function gLeave() {
    gMutate(x => {
        if (!x) return null;
        const me = myProfile.username;
        const wasTurn = x.turn === me;
        x.players = x.players.filter(p => p.u !== me);
        if (x.host === me && x.players.length) x.host = x.players[0].u;
        if (x.players.length < 2 && x.status === "playing") x.status = "ended";
        else if (!x.players.length) x.status = "ended";
        else if (wasTurn && x.status === "playing") gAdvance(x);
        return x;
    });
}
function gPick(kind) {
    gMutate(x => {
        if (!x || x.phase !== "choose" || x.turn !== myProfile.username) return null;
        x.phase = "source"; x.choice = kind; x.say = "";
        return x;
    });
}
function gWantMember() {
    gMutate(x => {
        if (!x || x.phase !== "source") return null;
        x.phase = "member";
        return x;
    });
}
function gMemberSend(text) {
    text = String(text || "").trim();
    if (!text) return;
    gMutate(x => {
        if (!x || x.phase !== "member") return null;
        gSetPrompt(x, x.choice, text, myProfile.username);
        return x;
    });
}
function gSkip() {
    gMutate(x => {
        if (!x || x.status !== "playing") return null;
        gAdvance(x);
        return x;
    });
}

async function gMochiPrompt(kind) {
    const s = G.state;
    if (!s || s.status !== "playing") return;
    const turnU = s.turn;
    await gThink(AI_NAME + " is thinking", async () => {
        const t = gPlayer(s, turnU);
        let text = "";
        try {
            const d = await mochiCall({
                mode: "prompt", room_id: String(G.room.id), kind,
                target: { username: t.u, name: t.n },
                players: s.players.map(p => p.n),
                history: (s.history || []).slice(-8)
            });
            text = String(d.text || "").trim();
        } catch (e) { console.error(e); }
        if (!text) text = gPickBank(kind, s.history);
        await gMutate(x => {
            if (!x || x.status !== "playing" || x.turn !== turnU ||
                !["source", "member", "prompt"].includes(x.phase)) return null;
            gSetPrompt(x, kind, text, AI_NAME);
            return x;
        });
    });
}

async function gFinish(answer) {
    const s = G.state;
    if (!s || s.phase !== "prompt") return;
    await gThink(AI_NAME + " is thinking", async () => {
        let text = "";
        try {
            const d = await mochiCall({
                mode: "react", room_id: String(G.room.id), kind: s.choice,
                prompt: s.prompt, answer, target: gPlayer(s, s.turn).n
            });
            text = String(d.text || "").trim();
        } catch (e) { console.error(e); }
        if (!text) text = gLine(TOD_REACT);
        G.draft = "";
        await gMutate(x => {
            if (!x || x.phase !== "prompt") return null;
            x.phase = "reaction"; x.answer = answer || null; x.say = text;
            return x;
        });
    });
}

// Applies an action that the AI returned after a chat mention
async function gApplyAIAction(room, a) {
    const row = await gGet(room);
    if (!row || !row.state || row.state.status !== "playing") return;
    const s = JSON.parse(JSON.stringify(row.state));
    if (a.type === "prompt" && a.text && (a.kind === "truth" || a.kind === "dare")) {
        if (!["choose", "source", "member"].includes(s.phase)) return;
        gSetPrompt(s, a.kind, a.text, AI_NAME);
    } else if (a.type === "next" && s.players.some(p => p.u === a.target)) {
        s.counts = s.counts || {};
        s.turn = a.target; s.phase = "choose";
        s.choice = null; s.prompt = null; s.promptBy = null; s.answer = null;
        s.say = AI_NAME + " has chosen " + gPlayer(s, a.target).n + " 👑";
    } else return;
    if (await gSet(room, s, row.rev) && G.room && String(G.room.id) === String(room.id)) {
        G.state = s; G.rev = row.rev + 1;
        if (!G.thinking) renderToD();
    }
}

// ---------- games UI ----------
const G_ICONS = {
    tod: '<svg viewBox="0 0 24 24"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>',
    wyr: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/></svg>',
    nhie: '<svg viewBox="0 0 24 24"><path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.500-2.700-2-4.500-2A5.500 5.500 0 0 0 2 8.500c0 2.300 1.500 4 3 5.500l7 7Z"/></svg>',
    chal: '<svg viewBox="0 0 24 24"><path d="M6 9H4.500a2.500 2.500 0 0 1 0-5H6M18 9h1.500a2.500 2.500 0 0 0 0-5H18M4 22h16M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>'
};
const GAME_BTN_SVG = '<svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4M8 10v4M15 13h.01M18 11h.01"/></svg>';

function buildGamesPage() {
    if ($("gamesPage")) return;
    const p = document.createElement("div");
    p.id = "gamesPage";
    p.className = "gpage hidden";
    p.innerHTML =
        '<header class="g-top">' +
            '<button type="button" id="gBack" class="hdr-btn"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>' +
            '<strong id="gTitle">Games</strong>' +
            '<button type="button" id="gClose" class="hdr-btn"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
        '</header>' +
        '<div id="gBody" class="g-body"></div>' +
        '<div id="gFoot" class="g-foot hidden">' +
            '<div id="gChips" class="g-chips"></div>' +
            '<form id="gSay" class="g-say">' +
                '<input id="gSayInput" type="text" autocomplete="off">' +
                '<button type="submit" class="send-btn" aria-label="Send"><svg viewBox="0 0 24 24"><path d="M21 3L10.5 13.5"/><path d="M21 3L15 21L10.5 13.5L3 9L21 3Z"/></svg></button>' +
            '</form>' +
        '</div>';
    document.body.appendChild(p);

    $("gBack").addEventListener("click", () => {
    if (G.view === "tod") {
        hsStop();
        showGamesMenu();
        return;
    }

    if (G.view === "mic") {
        mrStopSync();
        showGamesMenu();
        return;
    }

    closeGames();
});

$("gClose").addEventListener("click", () => {
    hsStop();
    mrStopSync();
    closeGames();
});
}

function gSendRoom(text) {
    if (!currentRoom || !myProfile) return;
    supabaseClient.from("messages")
        .insert({ room_id: currentRoom.id, username: myProfile.username, message: text })
        .then(({ error }) => { if (error) { console.error(error); gToast("Message nahi gaya"); } });
}

function openGames() {
    if (!currentRoom || !myProfile) return;
    if (dmOf(currentRoom)) { alert("Games sirf rooms mein hain, DM mein nahi."); return; }
    buildGamesPage();
    $("gamesPage").classList.remove("hidden");
    showGamesMenu();
}

function closeGames() {
    gStopSync();
        mrStopSync();
    G.view = "menu";
    const p = $("gamesPage");
    if (p) p.classList.add("hidden");
}

function showGamesMenu() {
    gStopSync();
    G.view = "menu";
    $("gTitle").textContent = "Games";
    $("gFoot").classList.add("hidden");
    const body = $("gBody");
    body.innerHTML = "";
    body.appendChild(gEl("p", "g-sub", "Play together, have fun!"));

    
    item("tod", "Truth or Dare", "Bold questions. Crazy dares. Who's next?", true);
    item("wyr", "Would You Rather", "Tough choices, funny debates. Coming soon", false);
    item("nhie", "Never Have I Ever", "Confess or get caught! Coming soon", false);
    item("chal", "Group Challenges", "Fun tasks, team up or complete Coming soon", false);
}

// ---------- Truth or Dare screen ----------
async function openToD() {
    G.view = "tod";
    G.room = currentRoom;
    G.loaded = false; G.state = null; G.rev = 0; G.draft = "";
    $("gTitle").textContent = "Truth or Dare";
    $("gBody").innerHTML = "";
    $("gBody").appendChild(gEl("p", "g-sub", "Loading..."));
    const row = await gGet(G.room);
    if (!row) { $("gBody").innerHTML = '<p class="g-sub">Game load nahi hui.</p>'; return; }
    gApplyRow(row, true);
    gStartSync();
}

function gStartSync() {
    gStopSync();
    const id = G.room.id;
    G.ch = supabaseClient.channel("game-" + id)
        .on("postgres_changes",
            { event: "*", schema: "public", table: "room_games", filter: "room_id=eq." + id },
            p => { const r = p.new; if (r && r.state) gApplyRow({ state: r.state, rev: r.rev }); })
        .subscribe();
    // Polling is a safety net in case realtime is delayed
    G.poll = setInterval(async () => {
        if (!currentRoom) { closeGames(); return; }
        if (G.busy || G.thinking) return;
        gApplyRow(await gGet(G.room));
    }, 4000);
}

function gStopSync() {
    if (G.poll) { clearInterval(G.poll); G.poll = null; }
    if (G.ch) { supabaseClient.removeChannel(G.ch); G.ch = null; }
}

function gShowAiLine(m) {
    const p = $("gamesPage");
    if (!p || p.classList.contains("hidden")) return;
    if (Date.now() - new Date(m.created_at).getTime() > 30000) return;
    G.aiText = m.message || "";
    clearTimeout(G.aiTimer);
    G.aiTimer = setTimeout(() => { G.aiText = ""; if (G.view === "tod") renderToD(); }, 20000);
    if (G.view === "tod" && !G.thinking) renderToD();
}

function gAiBubble(text) {
    const row = gEl("div", "g-ai");
    const av = gEl("div", "g-av");
    av.style.backgroundImage = 'url("' + AI_AVATAR + '")';
    row.append(av, gEl("div", "g-ai-bubble", text));
    return row;
}

function gPlayerRow(p, tag) {
    const row = gEl("div", "g-prow");
    const av = gEl("div", "g-av");
    paintAvatar(av, p.a, p.n);
    row.append(av, gEl("strong", "", p.n));
    if (tag) row.append(gEl("span", "g-tag", tag));
    return row;
}

function gPromptCard(s) {
    const c = gEl("div", "g-card g-prompt");
    c.append(gEl("span", "g-badge " + s.choice, s.choice === "dare" ? "Dare" : "Truth"));
    c.append(gEl("div", "g-ptxt", s.prompt));
    c.append(gEl("div", "g-by", "by " + (s.promptBy === AI_NAME ? AI_NAME : gPlayer(s, s.promptBy).n)));
    return c;
}

function renderToD() {
    const body = $("gBody");
    if (!body || G.view !== "tod" || !myProfile) return;
    const ta = body.querySelector(".g-answer");
    if (ta) G.draft = ta.value;
    body.innerHTML = "";
    const s = G.state;
    $("gFoot").classList.toggle("hidden", !(s && s.status === "playing"));

    if (G.aiText) body.appendChild(gAiBubble(G.aiText));

    if (!s || s.status === "ended") {
        const c = gEl("div", "g-card");
        c.append(gEl("div", "g-label", "Truth or Dare"));
        c.append(gEl("p", "g-info", "Room members will take turns choosing Truth or Dare. Prompts can come from " + AI_NAME + ", or friends can create their own."));
        body.append(c, gBtn("Create game", "g-main", gCreate));
        return;
    }

    const me = myProfile.username;
    const joined = s.players.some(p => p.u === me);

    if (s.status === "lobby") {
        const c = gEl("div", "g-card");
        c.append(gEl("div", "g-label", "Players (" + s.players.length + ")"));
        s.players.forEach(p => c.append(gPlayerRow(p, p.u === s.host ? "Host" : "")));
        body.append(c);
        if (!joined) body.append(gBtn("Join game", "g-main", gJoin));
        else if (s.host === me) {
            const start = gBtn(s.players.length < 2 ? "Need 2+ players" : "Start game", "g-main", gStart);
            if (s.players.length < 2) start.disabled = true;
            body.append(start, gBtn("Cancel game", "g-ghost", gEnd));
        } else {
            body.append(gEl("p", "g-wait", "Waiting for the host to start..."), gBtn("Leave", "g-ghost", gLeave));
        }
        return;
    }
// status === "playing"
    const turnP = gPlayer(s, s.turn);
    const mine = s.turn === me;
    const host = s.host === me;

    if (!joined) body.append(gBtn("Join game", "g-main", gJoin));

    const card = gEl("div", "g-card");
    card.append(gEl("div", "g-label", "Current Turn"));
    const trow = gEl("div", "g-turnrow");
    const tav = gEl("div", "g-av big");
    paintAvatar(tav, turnP.a, turnP.n);
    const ttx = gEl("div", "g-turntext");
    ttx.append(gEl("strong", "", turnP.n), gEl("span", "", mine ? "It's your turn!" : "Their turn"));
    trow.append(tav, ttx);
    card.append(trow);
    body.append(card);

    if (s.say) body.append(gAiBubble(s.say));

    if (G.thinking) {
        body.append(gEl("p", "g-wait", G.thinking + "..."));
    } else if (s.phase === "choose") {
        if (mine) {
            body.append(gEl("div", "g-label", "Choose your option"));
            const r = gEl("div", "g-two");
            r.append(gBtn("Truth", "g-big truth", () => gPick("truth")),
                     gBtn("Dare", "g-big dare", () => gPick("dare")));
            body.append(r);
        } else body.append(gEl("p", "g-wait", turnP.n + " is choosing Truth or Dare..."));
    } else if (s.phase === "source") {
        body.append(gEl("div", "g-label", (s.choice === "dare" ? "Dare" : "Truth") + " it is"));
        if (mine) {
            body.append(gEl("div", "g-label", "Or get one from:"));
            const r = gEl("div", "g-two");
            r.append(gBtn("Ask " + AI_NAME, "g-ghost", () => gMochiPrompt(s.choice)),
                     gBtn("Another member", "g-ghost", gWantMember));
            body.append(r);
        } else body.append(gEl("p", "g-wait", "Waiting for " + turnP.n + " to pick a source..."));
    } else if (s.phase === "member") {
        if (mine) {
            body.append(gEl("p", "g-wait", "Waiting for a friend to give you a " + s.choice + "..."),
                        gBtn("Ask " + AI_NAME + " instead", "g-ghost", () => gMochiPrompt(s.choice)));
        } else {
            const f = gEl("form", "g-say");
            const inp = gEl("input");
            inp.placeholder = "Give " + turnP.n + " a " + s.choice + "...";
            const go = gEl("button", "send-btn");
            go.type = "submit";
            go.innerHTML = '<svg viewBox="0 0 24 24"><path d="M21 3L10.5 13.5"/><path d="M21 3L15 21L10.5 13.5L3 9L21 3Z"/></svg>';
            f.append(inp, go);
            f.addEventListener("submit", e => { e.preventDefault(); gMemberSend(inp.value); });
            body.append(f, gBtn("Let " + AI_NAME + " do it", "g-ghost", () => gMochiPrompt(s.choice)));
        }
    } else if (s.phase === "prompt") {
        body.append(gPromptCard(s));
        if (mine) {
            const ta2 = gEl("textarea", "g-answer");
            ta2.placeholder = "Your answer (optional)";
            ta2.value = G.draft || "";
            const done = gBtn("Done", "g-main", () => gFinish(ta2.value.trim()));
            body.append(ta2, done);
        } else body.append(gEl("p", "g-wait", turnP.n + " is answering..."));
        if (mine || host) {
            const r = gEl("div", "g-two");
            if (s.promptBy === AI_NAME) r.append(gBtn("Regenerate", "g-ghost", () => gMochiPrompt(s.choice)));
            r.append(gBtn("Skip", "g-ghost", gSkip));
            body.append(r);
        }
    } else if (s.phase === "reaction") {
        body.append(gPromptCard(s));
        if (s.answer) body.append(gEl("div", "g-card g-answered", turnP.n + ": " + s.answer));
        body.append(gBtn("Next Turn", "g-main", gSkip));
    }

    const info = gEl("div", "g-card");
    info.append(gEl("div", "g-label", "Game info"));
    info.append(gEl("p", "g-info", s.players.length + " players · Turn based"));
    const r2 = gEl("div", "g-two");
    r2.append(gBtn("Leave game", "g-ghost", gLeave));
    if (host) r2.append(gBtn("End game", "g-ghost danger", gEnd));
    info.append(r2);
    body.append(info);
}

// ---------- Games buttons in both headers (added from JS, no HTML edit) ----------
function gEnsureButtons() {
    const a = $("editRoomBtn");
    if (a && !$("gamesBtn")) {
        const b = gEl("button", "hdr-btn");
        b.id = "gamesBtn"; b.type = "button"; b.title = "Games";
        b.innerHTML = GAME_BTN_SVG;
        b.addEventListener("click", openGames);
        a.before(b);
    }
    const v = $("vMenu");
    if (v && !$("vGamesBtn")) {
        const b = gEl("button", "hdr-btn");
        b.id = "vGamesBtn"; b.type = "button"; b.title = "Games";
        b.innerHTML = GAME_BTN_SVG;
        b.addEventListener("click", openGames);
        v.before(b);
    }
}
new MutationObserver(gEnsureButtons).observe(document.body, { childList: true, subtree: true });
gEnsureButtons();
// ================================
// LANGUAGE-AWARE GAMES
// Appended at the very end of auth.js. Overrides the earlier definitions.
// ================================

// Rolling buffer of recent room messages (used to detect the room's language)
const gRecent = [];
function gTrack(m) {
    if (!m || !m.id || m.audio_url || m.media_url || !m.message || isAI(m.username)) return;
    if (gRecent.some(x => x.id === m.id)) return;
    gRecent.push({ id: m.id, r: String((currentRoom || {}).id), u: m.username, t: String(m.message) });
    if (gRecent.length > 80) gRecent.shift();
}
const _dmLang = displayMessage;
displayMessage = function (m) { try { gTrack(m); } catch (e) {} _dmLang(m); };
const _avmLang = addVoiceMsg;
addVoiceMsg = function (m) { try { gTrack(m); } catch (e) {} _avmLang(m); };

// ---------- language detection (English / Roman Urdu / mix) ----------
const RU_W = new Set("hai hain nahi nahin nai kya kyun kyu kaise kab kahan kaha kaun kon main mai mein mujhe mujhko meri mera mere tum tu tera teri tere tumhari tumhara apna apni aap hum humne ye yeh wo woh isko usko isse usse aur ya lekin magar par toh bhi na nah haan han ji acha accha achha thik theek sahi bohot bahut zyada thoda thori bas abhi kal aaj agar jab tab phir fir kuch koi sab sabhi karo karna kar kiya kiye ki ka ke ko se ne tha thi the raha rahi rahe hoga hogi hona ho gaya gayi gaye yaar yar yr bhai chal chalo dekho bata batao bol bolo suno mat nhi hn kro krna krta krte lag lgta ab abi uski uska unka unki yaha waha yahan wahan".split(" "));
const EN_W = new Set("the a an and or but is are was were be been i you he she we they it me my your his her our their this that these those what why how when where who which have has had will would can could should not no yes yeah yep ok okay please thanks thank hello hey just really very so too with without for from of in on at by about like love hate know think want need make get going come see tell give take let say said one two dude lol omg wtf literally actually honestly".split(" "));

function gLangOf(texts) {
    const words = texts.join(" ").toLowerCase().match(/[a-z']+/g) || [];
    let ru = 0, en = 0;
    words.forEach(w => {
        if (RU_W.has(w) && !EN_W.has(w)) ru++;
        else if (EN_W.has(w) && !RU_W.has(w)) en++;
    });
    if (ru + en < 3) return null; // not enough signal
    const share = ru / (ru + en);
    return share >= 0.65 ? "ur" : share <= 0.2 ? "en" : "mix";
}

// Language of one player's recent messages, falling back to the whole room, then "mix"
function gLang(user) {
    const rid = String((G.room || currentRoom || {}).id);
    const inRoom = gRecent.filter(x => x.r === rid);
    const own = user ? inRoom.filter(x => x.u === user).slice(-8).map(x => x.t) : [];
    return gLangOf(own) || gLangOf(inRoom.slice(-15).map(x => x.t)) || "mix";
}

// ---------- offline fallback content in both languages ----------
const TOD_BANK = {
    en: {
        truth: [
            "Who was the last person you ghosted, and why? Be honest 👀",
            "What's the most embarrassing thing in your search history? Delete it after you answer 😭",
            "Whose message do you leave on seen on purpose?",
            "What's the cringiest post or story you've ever put up?",
            "If your crush texted 'hi' tonight, what would your first reaction be?",
            "Ever sent a message to the wrong person? What did it say?",
            "Name 3 of your own red flags. No lying 😌",
            "What's one thing about your ex that you still cringe about?",
            "Who in this room do you gossip about the most?",
            "What's the biggest lie you told and never got caught?",
            "What's the most embarrassing song on your secret guilty-pleasure playlist?",
            "What did you fake so well that you deserved an Oscar?"
        ],
        dare: [
            "Turn your last 5 emojis into a mini story and send it as a voice note.",
            "Write your next 3 messages like Shakespeare 🎭",
            "Give another member a 30-second Oscar-winning compliment.",
            "End every message with 'bestie' for the next 5 minutes.",
            "Write a rap that includes everyone's name in this room and send it as a voice note.",
            "Describe the 7th photo in your gallery without showing it, and let everyone guess.",
            "Give yourself a 20-second pep talk and send it as a voice note.",
            "Write one cheesy pickup line (no real names) and let the group rate it.",
            "Write a loving two-line roast for someone in this room.",
            "Send your next 3 messages using only emojis.",
            "Defend your oldest favorite song in 3 lines.",
            "Show off your weirdest talent in a 10-second voice note."
        ],
        react: [
            "Bruh 😭 that was so cringe, but respect.",
            "Okay drama king/queen, noted 👀",
            "Rating: 7/10, needed a bit more chaos 😌",
            "10/10 for the plot twist 🔥",
            "Hmm... suspicious. Are you lying? 🤨",
            "I've saved this answer. It'll come in handy later 😈"
        ],
        turn: ["Alright {n}... this is gonna be fun 😏", "{n}, you're up. Don't run away 👀", "Okay {n}, drama time 🍿"],
        prompt: ["Think before you answer 👀", "No excuses, bestie 😈", "Oof, this one's spicy 🌶️"],
        chosen: "{ai} has chosen {n} 👑"
    },
    ur: {
        truth: TOD_TRUTHS, dare: TOD_DARES, react: TOD_REACT,
        turn: TOD_LINES.turn, prompt: TOD_LINES.prompt,
        chosen: "{ai} ne {n} ko chuna 👑"
    }
};

function gBank(lang) {
    if (lang === "mix") lang = Math.random() < 0.5 ? "en" : "ur";
    return TOD_BANK[lang] || TOD_BANK.en;
}
function gSay(key, name, user) {
    const arr = gBank(gLang(user))[key];
    return arr[Math.floor(Math.random() * arr.length)].replace("{n}", name || "");
}
function gPickBank(kind, history) {
    const user = G.state ? G.state.turn : "";
    const bank = gBank(gLang(user))[kind === "dare" ? "dare" : "truth"];
    const fresh = bank.filter(t => !(history || []).includes(t));
    const pool = fresh.length ? fresh : bank;
    return pool[Math.floor(Math.random() * pool.length)];
}

// ---------- overrides that use the language logic ----------
function gAdvance(s) {
    s.counts = s.counts || {};
    if (s.turn) s.counts[s.turn] = (s.counts[s.turn] || 0) + 1;
    const others = s.players.filter(p => p.u !== s.turn);
    const pool = others.length ? others : s.players;
    const min = Math.min(...pool.map(p => s.counts[p.u] || 0));
    const cand = pool.filter(p => (s.counts[p.u] || 0) === min);
    const nxt = cand[Math.floor(Math.random() * cand.length)];
    s.turn = nxt.u;
    s.phase = "choose";
    s.choice = null; s.prompt = null; s.promptBy = null; s.answer = null;
    s.round = (s.round || 0) + 1;
    s.say = gBank(gLang(nxt.u)).chosen.replace("{ai}", AI_NAME).replace("{n}", nxt.n);
}

function gSetPrompt(x, kind, text, by) {
    x.phase = "prompt";
    x.choice = kind;
    x.prompt = String(text).slice(0, 300);
    x.promptBy = by;
    x.answer = null;
    x.say = gSay("prompt", "", x.turn);
    x.history = [...(x.history || []), x.prompt].slice(-12);
}

function gStart() {
    gMutate(x => {
        if (!x || x.status !== "lobby" || x.host !== myProfile.username || x.players.length < 2) return null;
        const first = x.players[Math.floor(Math.random() * x.players.length)];
        x.status = "playing"; x.turn = first.u; x.phase = "choose"; x.counts = {}; x.round = 1;
        x.say = gSay("turn", first.n, first.u);
        return x;
    });
}

async function gMochiPrompt(kind) {
    const s = G.state;
    if (!s || s.status !== "playing") return;
    const turnU = s.turn;
    await gThink(AI_NAME + " is thinking", async () => {
        const t = gPlayer(s, turnU);
        let text = "";
        try {
            const d = await mochiCall({
                mode: "prompt", room_id: String(G.room.id), kind,
                target: { username: t.u, name: t.n },
                players: s.players.map(p => p.n),
                history: (s.history || []).slice(-8),
                lang_hint: gLang(turnU)
            });
            text = String(d.text || "").trim();
        } catch (e) { console.error(e); }
        if (!text) text = gPickBank(kind, s.history);
        await gMutate(x => {
            if (!x || x.status !== "playing" || x.turn !== turnU ||
                !["source", "member", "prompt"].includes(x.phase)) return null;
            gSetPrompt(x, kind, text, AI_NAME);
            return x;
        });
    });
}

async function gFinish(answer) {
    const s = G.state;
    if (!s || s.phase !== "prompt") return;
    await gThink(AI_NAME + " is thinking", async () => {
        let text = "";
        try {
            const d = await mochiCall({
                mode: "react", room_id: String(G.room.id), kind: s.choice,
                prompt: s.prompt, answer, target: gPlayer(s, s.turn).n,
                lang_hint: gLang(s.turn)
            });
            text = String(d.text || "").trim();
        } catch (e) { console.error(e); }
        if (!text) text = gSay("react", "", s.turn);
        G.draft = "";
        await gMutate(x => {
            if (!x || x.phase !== "prompt") return null;
            x.phase = "reaction"; x.answer = answer || null; x.say = text;
            return x;
        });
    });
}

async function askMochi(m, mode) {
    const room = currentRoom;
    if (!room) return;
    try {
        const game = await gCompactGame(room);
        const d = await mochiCall({
            mode, room_id: String(room.id), message_id: m.id, game,
            lang_hint: gLang(myProfile.username)
        });
        if (d.action && game) await gApplyAIAction(room, d.action);
    } catch (e) {
        console.error("mochi:", e);
        if (mode === "chat") gToast(AI_NAME + " is offline now");
    }
}
// ================================
// AI OFF SWITCH
// Turns the mochi AI off without deleting anything.
// Delete this block later to turn it back on.
// ================================
function aiHook(m) { /* AI disabled */ }
async function askMochi() { /* AI disabled */ }
async function mochiCall() { throw new Error("AI is switched off"); }
// ================================
// VOICE QUALITY MONITOR + ADAPTIVE BITRATE
// Must be placed below the "VOICE ROOM v3" block
// ================================
const VRTC = {
    on: false,
    peers: {},
    level: "",
    rate: 64000,
    prev: {},
    goodRun: 0
};
VRTC.level = "";     // "good" | "ok" | "poor"
VRTC.rate = 64000;   // current max send bitrate
VRTC.prev = {};      // previous packet counters per peer
VRTC.goodRun = 0;

async function rtcTune(st) {
    try {
        if (!st.tx) return;
        const s = st.tx.sender;
        const p = s.getParameters();
        if (!p.encodings || !p.encodings.length) p.encodings = [{}];
        const crowd = Object.keys(VRTC.peers).length > 6 ? 40000 : 64000;
        p.encodings[0].maxBitrate = Math.min(crowd, VRTC.rate || 64000);
        p.encodings[0].priority = "high";
        p.encodings[0].networkPriority = "high";
        await s.setParameters(p);
    } catch (e) { /* not ready yet */ }
}

function rtcShowStatus() {
    const el = document.querySelector("#voicePage .v-live");
    if (!el) return;
    const ok = Object.values(VRTC.peers).filter(s => ["connected", "completed"].includes(s.pc.iceConnectionState));
    const relay = ok.some(s => s.route === "relay");
    el.textContent = ok.length
        ? "● Live · " + ok.length + " linked" + (relay ? " (relay)" : "") + (VRTC.level ? " · " + VRTC.level : "")
        : "● Live";
}

async function rtcMonitor() {
    if (!VRTC.on) return;
    let loss = 0, rtt = 0, n = 0;

    for (const st of Object.values(VRTC.peers)) {
        if (!["connected", "completed"].includes(st.pc.iceConnectionState)) continue;
        try {
            const stats = await st.pc.getStats();
            n++;
            stats.forEach(r => {
                // How my audio arrives at the other person (what they report back)
                if (r.type === "remote-inbound-rtp" && r.kind === "audio") {
                    if (typeof r.fractionLost === "number") loss = Math.max(loss, r.fractionLost);
                    if (r.roundTripTime) rtt = Math.max(rtt, r.roundTripTime);
                }
                // How other people's audio arrives at me
                if (r.type === "inbound-rtp" && r.kind === "audio") {
                    const prev = VRTC.prev[st.user] || { lost: 0, got: 0 };
                    const dLost = r.packetsLost - prev.lost;
                    const dGot = r.packetsReceived - prev.got;
                    VRTC.prev[st.user] = { lost: r.packetsLost, got: r.packetsReceived };
                    if (dLost >= 0 && dGot >= 0 && dLost + dGot > 20) loss = Math.max(loss, dLost / (dLost + dGot));
                }
                if (r.type === "candidate-pair" && r.nominated && r.state === "succeeded" && r.currentRoundTripTime) {
                    rtt = Math.max(rtt, r.currentRoundTripTime);
                }
            });
        } catch (e) {}
    }

    if (!n) { VRTC.level = ""; rtcShowStatus(); return; }

    const level = (loss > 0.08 || rtt > 0.6) ? "poor" : (loss > 0.02 || rtt > 0.3) ? "ok" : "good";
    VRTC.level = level;

    // Drop the bitrate quickly when the network is bad, raise it slowly when it recovers
    let rate = VRTC.rate;
    if (level === "poor") { rate = 24000; VRTC.goodRun = 0; }
    else if (level === "ok") { rate = Math.min(rate, 40000); VRTC.goodRun = 0; }
    else if (++VRTC.goodRun >= 3) rate = 64000;

    if (rate !== VRTC.rate) {
        VRTC.rate = rate;
        Object.values(VRTC.peers).forEach(rtcTune);
    }
    rtcShowStatus();
}
setInterval(rtcMonitor, 4000);
// ================================
// VOICE SEATS v4: cute seats + seat layouts
// Overrides renderVoice and openVoiceMenu
// To add a layout, add a line here (and keep the count between 4 and 24 in the SQL)
// ================================
const VLAYOUTS = {
    6:  { cols: 3, size: 76, label: "6 seats · big" },
    9:  { cols: 3, size: 58, label: "9 seats · medium" },
    12: { cols: 4, size: 52, label: "12 seats · small" }
};
const VSEAT = { fetchedFor: null };

// Fetch the saved layout once per visit (the room object may be stale)
function vSeatsFetch() {
    if (!vRoom || !vState || VSEAT.fetchedFor === vState.sid) return;
    VSEAT.fetchedFor = vState.sid;
    supabaseClient.from("rooms").select("seat_count").eq("id", vRoom.id).maybeSingle()
        .then(({ data }) => {
            if (data && data.seat_count && vRoom) {
                vRoom.seat_count = data.seat_count;
                renderVoice();
            }
        });
}

// The host's presence carries the live layout; the database value is the fallback
function vSeatCount() {
    let n = 0;
    if (vState && vState.layout && isHost()) n = vState.layout;
    else {
        const h = vUsers().find(u => u.username === vHost);
        if (h && h.layout) n = h.layout;
    }
    if (!n && vRoom && vRoom.seat_count) n = Number(vRoom.seat_count);
    return VLAYOUTS[n] ? n : 9;
}

function renderVoice() {
    if (!vRoom || !vState || !$("vSeats")) return;
    const me = vState.username;
    vSeatsFetch();

    const users = vUsers().filter(u => u.username !== me);
    users.push(vState);

    const count = vSeatCount();
    const L = VLAYOUTS[count] || VLAYOUTS[9];

    // If two people took the same seat, the earliest one keeps it
    const bySeat = {};
    users.forEach(u => {
        if (u.seat === null || u.seat === undefined || u.seat >= count) return;
        const cur = bySeat[u.seat];
        const a = u.seatAt || 0;
        const b = cur ? (cur.seatAt || 0) : 0;
        if (!cur || a < b || (a === b && u.username < cur.username)) bySeat[u.seat] = u;
    });

    // If the layout shrank and my seat no longer exists, move me to a free seat
    if (vState.seat !== null && vState.seat >= count) {
        let free = -1;
        for (let i = 0; i < count; i++) { if (!bySeat[i]) { free = i; break; } }
        if (free >= 0) { vState.seat = free; bySeat[free] = vState; }
        else { vState.seat = null; vState.seatAt = 0; vState.muted = true; vState.speaking = false; }
        vTrack();
    }

    if (vState.seat !== null && bySeat[vState.seat] && bySeat[vState.seat].username !== me) {
        vState.seat = null;
        vState.seatAt = 0;
        vState.muted = true;
        vState.speaking = false;
        vTrack();
    }

    $("vCount").textContent = users.length + (users.length === 1 ? " person" : " people");

    const grid = $("vSeats");
    grid.style.setProperty("--cols", L.cols);
    grid.style.setProperty("--sz", L.size + "px");
    grid.innerHTML = "";
    for (let i = 0; i < count; i++) {
        const u = bySeat[i];
        const cell = document.createElement("div");
        cell.className = "v-seat";
        const circle = document.createElement("div");
        circle.className = "v-circle";
        const label = document.createElement("span");
        label.className = "v-label";
        const sub = document.createElement("span");
        sub.className = "v-sub";

        if (u) {
            paintAvatar(circle, u.avatar, u.name || u.username);
            if (u.username === vHost) circle.classList.add("host");
            if (u.speaking && !u.muted) circle.classList.add("speaking");
            if (u.muted) {
                const b = document.createElement("i");
                b.className = "v-badge";
                b.innerHTML = VIC.micOff;
                circle.appendChild(b);
            }
            if (u.hand) {
                const h = document.createElement("i");
                h.className = "v-hand";
                h.innerHTML = VIC.hand;
                circle.appendChild(h);
            }
            label.textContent = u.name || u.username;
            sub.textContent = u.username === vHost ? "Host"
                : u.hand ? "Hand raised"
                : (u.speaking && !u.muted) ? "Speaking"
                : u.muted ? "Muted" : "";
        } else {
            circle.classList.add("empty");
            circle.textContent = "+";
            label.textContent = "Take Seat";
        }

        cell.append(circle, label, sub);
        cell.addEventListener("click", () => onSeatTap(i, u));
        grid.appendChild(cell);
    }

    const live = vState.seat !== null && !vState.muted;
    $("vMic").classList.toggle("live", live);
    $("vMicIc").innerHTML = live ? VIC.mic : VIC.micOff;
    $("vMicLbl").textContent = live ? "Mute" : "Unmute";
    $("vHand").classList.toggle("active", !!vState.hand);
}

function openSeatLayout() {
    if (!isHost()) { alert("Only the host can change the seat layout."); return; }
    const cur = vSeatCount();
    const items = Object.keys(VLAYOUTS).map(k => [
        (Number(k) === cur ? "✓ " : "") + VLAYOUTS[k].label,
        () => setSeatLayout(Number(k))
    ]);
    items.push(["Cancel", () => {}]);
    showSheet(items, "Seat layout");
}

async function setSeatLayout(n) {
    if (!vRoom || !vState || !isHost()) return;
    const { error } = await supabaseClient.rpc("set_seat_layout", { p_room: String(vRoom.id), p_count: n });
    if (error) { console.error(error); alert("Could not change layout: " + error.message); return; }
    vRoom.seat_count = n;
    vState.layout = n;
    vTrack();
    renderVoice();
}

function openVoiceMenu() {
    const items = [];
    if (isHost()) {
        items.push(["Seat layout", openSeatLayout]);
        items.push(["Mute everyone", () => {
            vChannel.send({ type: "broadcast", event: "mute_all", payload: {} });
        }]);
    }
    items.push(["Room info", openRoomInfo]);
    items.push(["Members", showMembers]);
    if (isHost()) items.push(["Edit name & photo", openEditRoom]);
    items.push(["Leave room permanently", leaveVoiceMembership, true]);
    items.push(["Cancel", () => {}]);
    showSheet(items, "Room menu");
}
// ================================
// HOT SEAT GAME
// One player sits in the Hot Seat for 60 seconds and everyone asks questions.
// Overrides buildGamesPage, showGamesMenu and closeGames so the menu lists Hot Seat.
// ================================
const HS = { room: null, key: "", rev: 0, state: null, offset: 0, ch: null, poll: null, tick: null, firing: false, loaded: false };
const HS_SECONDS = 60;
const HS_QUESTIONS = [
    "What's the most embarrassing thing in your camera roll?",
    "Who in this room would you call at 3am, and why?",
    "What's a red flag you ignored for way too long?",
    "What's your most unhinged hot take?",
    "What's the last lie you told?",
    "Which of your friends is the most chaotic?",
    "What's the cringiest thing you did to impress someone?",
    "Which song do you secretly love but never admit?"
];

G_ICONS.hot = '<svg viewBox="0 0 24 24"><path d="M5 11V8a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v3"/><path d="M3 13a2 2 0 0 1 4 0v3h10v-3a2 2 0 0 1 4 0v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M6 19v2M18 19v2"/></svg>';
G_ICONS.mic = '<svg viewBox="0 0 24 24"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></svg>';

// ---------- games page shell ----------
function buildGamesPage() {
    if ($("gamesPage")) return;
    const p = document.createElement("div");
    p.id = "gamesPage";
    p.className = "gpage hidden";
    p.innerHTML =
        '<header class="g-top">' +
            '<button type="button" id="gBack" class="hdr-btn"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>' +
            '<strong id="gTitle">Games</strong>' +
            '<button type="button" id="gClose" class="hdr-btn"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
        '</header>' +
        '<div id="gBody" class="g-body"></div>' +
        '<div id="gFoot" class="g-foot hidden">' +
            '<div id="gChips" class="g-chips"></div>' +
            '<form id="gSay" class="g-say">' +
                '<input id="gSayInput" type="text" autocomplete="off">' +
                '<button type="submit" class="send-btn" aria-label="Send"><svg viewBox="0 0 24 24"><path d="M21 3L10.5 13.5"/><path d="M21 3L15 21L10.5 13.5L3 9L21 3Z"/></svg></button>' +
            '</form>' +
        '</div>';
    document.body.appendChild(p);

    $("gBack").addEventListener("click", () => {
    if (G.view === "tod") {
        hsStop();
        showGamesMenu();
        return;
    }

    if (G.view === "mic") {
        mrStopSync();
        showGamesMenu();
        return;
    }

    closeGames();
});

$("gClose").addEventListener("click", () => {
    hsStop();
    mrStopSync();
    closeGames();
});
    $("gClose").addEventListener("click", () => closeGames());

    $("gSayInput").placeholder = "Message the room";
    const chips = [
        ["Give me a dare", "give me a dare"],
        ["Give me a truth", "give me a truth"],
        ["Roast", "roast this"],
        ["Rate it", "rate this answer"],
        ["Who's next?", "pick the next player"]
    ];
    chips.forEach(([label, text]) => $("gChips").appendChild(
        gBtn(label, "g-chip", () => gSendRoom("@" + AI_NAME + " " + text))));
    $("gSay").addEventListener("submit", e => {
        e.preventDefault();
        const t = $("gSayInput").value.trim();
        if (!t) return;
        $("gSayInput").value = "";
        gSendRoom(t);
    });
}

function closeGames() {
    gStopSync();
    hsStop();
    G.view = "menu";
    const p = $("gamesPage");
    if (p) p.classList.add("hidden");
}

function showGamesMenu() {
    gStopSync();
    hsStop();
    G.view = "menu";
    $("gTitle").textContent = "Games";
    $("gFoot").classList.add("hidden");
    const body = $("gBody");
    body.innerHTML = "";
    delete body.dataset.hsMode;
    body.appendChild(gEl("p", "g-sub", "Play together, have fun!"));

    const item = (key, title, sub, active, fn) => {
    const b = gEl("button", "g-item" + (active ? " active" : " soon"));
    b.type = "button";

    const ico = gEl("div", "g-ico");
    ico.innerHTML = G_ICONS[key] || G_ICONS.tod;

    const txt = gEl("div", "g-txt");
    txt.append(
        gEl("strong", "", title),
        gEl("span", "", sub)
    );

    b.append(ico, txt);

    if (active && fn) {
        b.addEventListener("click", fn);
    }

    body.appendChild(b);
};
    item(
    "tod",
    "Truth or Dare",
    "Bold questions. Crazy dares. Who's next?",
    true,
    openToD
);

item(
    "mic",
    "Mic Roulette",
    "Spin the room. Get picked. Survive the prompt. 🎙️",
    true,
    openMicRoulette
);

item(
    "wyr",
    "Would You Rather",
    "Tough choices, funny debates. Coming soon",
    false
);

item(
    "nhie",
    "Never Have I Ever",
    "Confess or get caught! Coming soon",
    false
);

item(
    "chal",
    "Group Challenges",
    "Fun tasks, team up or compete. Coming soon",
    false
);
}

// ---------- shared state helpers (revision-checked, with retries) ----------
function hsNow() { return Date.now() + HS.offset; }
function hsPlayer(s, u) { return (s.players || []).find(p => p.u === u) || { u, n: u, a: null }; }

async function hsGet() {
    const { data, error } = await supabaseClient.rpc("game_get", { p_room: HS.key });
    if (error) { console.error(error); return null; }
    const r = data && data[0];
    if (!r) return { state: null, rev: 0 };
    if (r.server_ms) HS.offset = Number(r.server_ms) - Date.now();
    return { state: r.state, rev: r.rev };
}

async function hsMutate(fn) {
    for (let i = 0; i < 5; i++) {
        const row = await hsGet();
        if (!row) return false;
        const cur = row.state && row.state.status ? JSON.parse(JSON.stringify(row.state)) : null;
        const next = fn(cur);
        if (!next) { hsApply(row, true); return false; }
        const { data, error } = await supabaseClient.rpc("game_set", {
            p_room: HS.key, p_game: "hot", p_state: next, p_expected: row.rev
        });
        if (error) { console.error(error); return false; }
        if (data) { hsApply({ state: next, rev: row.rev + 1 }, true); return true; }
        // Someone else wrote at the same moment: wait a moment and try again
        await new Promise(r => setTimeout(r, 120 + Math.random() * 200));
    }
    return false;
}

function hsApply(row, force) {
    if (!row) return;
    if (!force && HS.loaded && row.rev <= HS.rev) return;
    HS.loaded = true;
    HS.state = row.state && row.state.status ? row.state : null;
    HS.rev = row.rev;
    hsRender();
}

// ---------- game actions ----------
function hsPickNext(s) {
    s.counts = s.counts || {};
    const others = s.players.filter(p => p.u !== s.seat);
    const pool = others.length ? others : s.players;
    const min = Math.min(...pool.map(p => s.counts[p.u] || 0));
    const cand = pool.filter(p => (s.counts[p.u] || 0) === min);
    const nxt = cand[Math.floor(Math.random() * cand.length)];
    s.seat = nxt.u;
    s.counts[nxt.u] = (s.counts[nxt.u] || 0) + 1;
    s.phase = "asking";
    s.passed = false;
    s.endsAt = Math.round(hsNow() + HS_SECONDS * 1000);
    s.qs = [];
    s.round = (s.round || 0) + 1;
}

function hsCreate() {
    hsMutate(cur => {
        if (cur && (cur.status === "lobby" || cur.status === "playing")) return null;
        return { game: "hot", status: "lobby", host: myProfile.username, players: [gMe()], counts: {}, qs: [], round: 0 };
    });
}
function hsJoin() {
    hsMutate(x => {
        if (!x || (x.status !== "lobby" && x.status !== "playing")) return null;
        if (!x.players.some(p => p.u === myProfile.username)) x.players.push(gMe());
        return x;
    });
}
function hsStartGame() {
    hsMutate(x => {
        if (!x || x.status !== "lobby" || x.host !== myProfile.username || x.players.length < 2) return null;
        x.status = "playing"; x.seat = null; x.counts = {};
        hsPickNext(x);
        return x;
    });
}
function hsEnd() {
    hsMutate(x => {
        if (!x || x.host !== myProfile.username) return null;
        x.status = "ended";
        return x;
    });
}
function hsLeave() {
    hsMutate(x => {
        if (!x) return null;
        const me = myProfile.username;
        const wasSeat = x.seat === me;
        x.players = x.players.filter(p => p.u !== me);
        if (x.host === me && x.players.length) x.host = x.players[0].u;
        if (!x.players.length || (x.players.length < 2 && x.status === "playing")) x.status = "ended";
        else if (wasSeat && x.status === "playing" && x.phase === "asking") { x.phase = "done"; x.passed = true; }
        return x;
    });
}
function hsAsk(text) {
    text = String(text || "").trim().slice(0, 140);
    if (!text) return;
    hsMutate(x => {
        const me = myProfile.username;
        if (!x || x.phase !== "asking" || x.seat === me || hsNow() > x.endsAt) return null;
        x.qs = x.qs || [];
        if (x.qs.filter(q => q.u === me).length >= 3) return null;   // 3 questions each per turn
        x.qs.push({ id: Math.random().toString(36).slice(2), u: me, n: myProfile.display_name || me, t: text, a: null });
        if (x.qs.length > 40) x.qs.shift();
        return x;
    });
}
function hsAnswer(text) {
    text = String(text || "").trim().slice(0, 200);
    if (!text) return;
    const ta = $("hsAns");
    if (ta) ta.value = "";
    hsMutate(x => {
        if (!x || x.phase !== "asking" || x.seat !== myProfile.username) return null;
        const q = (x.qs || []).find(z => !z.a && !z.skip);
        if (!q) return null;
        q.a = text;
        return x;
    });
}
function hsSkipQ() {
    hsMutate(x => {
        if (!x || x.phase !== "asking" || x.seat !== myProfile.username) return null;
        const q = (x.qs || []).find(z => !z.a && !z.skip);
        if (!q) return null;
        q.skip = true;
        return x;
    });
}
function hsPass() {
    hsMutate(x => {
        if (!x || x.phase !== "asking" || x.seat !== myProfile.username) return null;
        x.phase = "done"; x.passed = true;
        return x;
    });
}
function hsNext() {
    hsMutate(x => {
        if (!x || x.status !== "playing" || x.phase !== "done") return null;
        hsPickNext(x);
        return x;
    });
}
function hsSkipTurn() {
    hsMutate(x => {
        if (!x || x.status !== "playing" || x.host !== myProfile.username) return null;
        hsPickNext(x);
        return x;
    });
}

// ---------- sync ----------
async function openHot() {
    G.view = "hot";
    HS.room = currentRoom;
    HS.key = String(currentRoom.id) + "_hot";
    HS.loaded = false; HS.state = null; HS.rev = 0;
    $("gTitle").textContent = "Hot Seat";
    $("gFoot").classList.add("hidden");
    const body = $("gBody");
    body.dataset.hsMode = "";
    body.innerHTML = "";
    body.appendChild(gEl("p", "g-sub", "Loading..."));
    const row = await hsGet();
    if (!row) { body.innerHTML = '<p class="g-sub">Could not load the game.</p>'; return; }
    hsApply(row, true);
    hsStartSync();
}

function hsStartSync() {
    hsStop();
    const key = HS.key;
    HS.ch = supabaseClient.channel("hot-" + key)
        .on("postgres_changes",
            { event: "*", schema: "public", table: "room_games", filter: "room_id=eq." + key },
            p => { const r = p.new; if (r && r.state) hsApply({ state: r.state, rev: r.rev }); })
        .subscribe();
    // Polling is a safety net in case realtime is delayed
    HS.poll = setInterval(async () => {
        if (!currentRoom) { closeGames(); return; }
        const row = await hsGet();
        if (row) hsApply(row);
    }, 3000);
    HS.tick = setInterval(hsTick, 500);
}

function hsStop() {
    if (HS.poll) { clearInterval(HS.poll); HS.poll = null; }
    if (HS.tick) { clearInterval(HS.tick); HS.tick = null; }
    if (HS.ch) { supabaseClient.removeChannel(HS.ch); HS.ch = null; }
}

function hsTick() {
    const s = HS.state;
    if (G.view !== "hot" || !s || s.status !== "playing" || s.phase !== "asking" || !s.endsAt) return;
    const leftMs = s.endsAt - hsNow();
    const el = $("hsTimer");
    if (el) el.textContent = Math.max(0, Math.ceil(leftMs / 1000)) + "s";
    const bar = $("hsBar");
    if (bar) bar.style.width = Math.max(0, Math.min(100, (leftMs / (HS_SECONDS * 1000)) * 100)) + "%";
    if (leftMs <= 0 && !HS.firing) {
        // Whoever notices first ends the turn; the revision check makes sure only one write wins
        HS.firing = true;
        hsMutate(x => (!x || x.phase !== "asking" || hsNow() < x.endsAt) ? null : Object.assign(x, { phase: "done", passed: false }))
            .finally(() => { HS.firing = false; });
    }
}

// ---------- UI ----------
function hsIdeas() {
    return HS_QUESTIONS.slice().sort(() => Math.random() - 0.5).slice(0, 4);
}

function hsRender() {
    const body = $("gBody");
    if (!body || G.view !== "hot" || !myProfile) return;
    $("gFoot").classList.add("hidden");
    const s = HS.state;
    const me = myProfile.username;
    const joined = !!s && s.players.some(p => p.u === me);

    let mode;
    if (!s || s.status === "ended") mode = "none";
    else if (s.status === "lobby") mode = "lobby|" + s.players.map(p => p.u).join(",") + "|" + s.host + "|" + joined;
    else mode = ["play", s.phase, s.seat, s.round, joined, s.host].join("|");

    // Only rebuild the screen when something structural changed (keeps typing and focus intact)
    if (body.dataset.hsMode === mode) { hsLive(); return; }
    body.dataset.hsMode = mode;
    body.innerHTML = "";

    if (mode === "none") {
        const c = gEl("div", "g-card");
        c.append(gEl("div", "g-label", "Hot Seat"));
        c.append(gEl("p", "g-info", "One random player sits in the Hot Seat for 60 seconds. Everyone else asks questions. Pass if it gets too spicy."));
        body.append(c, gBtn("Create game", "g-main", hsCreate));
        return;
    }

    if (s.status === "lobby") {
        const c = gEl("div", "g-card");
        c.append(gEl("div", "g-label", "Players (" + s.players.length + ")"));
        s.players.forEach(p => c.append(gPlayerRow(p, p.u === s.host ? "Host" : "")));
        body.append(c);
        if (!joined) body.append(gBtn("Join game", "g-main", hsJoin));
        else if (s.host === me) {
            const start = gBtn(s.players.length < 2 ? "Need 2+ players" : "Start game", "g-main", hsStartGame);
            if (s.players.length < 2) start.disabled = true;
            body.append(start, gBtn("Cancel game", "g-ghost", hsEnd));
        } else {
            body.append(gEl("p", "g-wait", "Waiting for the host to start..."), gBtn("Leave", "g-ghost", hsLeave));
        }
        return;
    }

    // playing
    const seatP = hsPlayer(s, s.seat);
    const iAmSeat = s.seat === me;
    const host = s.host === me;

    if (!joined) body.append(gBtn("Join game", "g-main", hsJoin));

    const top = gEl("div", "g-card");
    const row = gEl("div", "hs-top");
    const av = gEl("div", "g-av big");
    paintAvatar(av, seatP.a, seatP.n);
    const tx = gEl("div", "g-turntext");
    tx.append(
        gEl("strong", "", seatP.n),
        gEl("span", "", s.phase === "done"
            ? (s.passed ? "passed this one 😅" : "Time's up! ⏰")
            : (iAmSeat ? "You're in the Hot Seat 🔥" : "is in the Hot Seat 🔥"))
    );
    row.append(av, tx);
    if (s.phase === "asking") {
        const t = gEl("div", "hs-time");
        t.id = "hsTimer";
        row.append(t);
    }
    top.append(row);
    if (s.phase === "asking") {
        const w = gEl("div", "hs-barwrap");
        const b = gEl("div", "hs-bar");
        b.id = "hsBar";
        w.append(b);
        top.append(w);
    }
    body.append(top);

    const feed = gEl("div", "hs-feed");
    feed.id = "hsFeed";
    body.append(feed);

    if (s.phase === "asking") {
        if (iAmSeat) {
            const cur = gEl("div", "g-card hs-cur");
            cur.id = "hsCur";
            const ans = gEl("input");
            ans.id = "hsAns";
            ans.placeholder = "Your answer (or just say it out loud)";
            ans.maxLength = 200;
            ans.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); hsAnswer(ans.value); } });
            const r = gEl("div", "g-two");
            r.append(gBtn("Send answer", "g-main", () => hsAnswer(ans.value)), gBtn("Skip question", "g-ghost", hsSkipQ));
            body.append(cur, ans, r, gBtn("Pass (leave the Hot Seat)", "g-ghost", hsPass));
        } else {
            const f = gEl("form", "g-say");
            const inp = gEl("input");
            inp.id = "hsAsk";
            inp.placeholder = "Ask " + seatP.n + " something...";
            inp.maxLength = 140;
            const go = gEl("button", "send-btn");
            go.type = "submit";
            go.innerHTML = '<svg viewBox="0 0 24 24"><path d="M21 3L10.5 13.5"/><path d="M21 3L15 21L10.5 13.5L3 9L21 3Z"/></svg>';
            f.append(inp, go);
            f.addEventListener("submit", e => {
                e.preventDefault();
                const t = inp.value.trim();
                if (!t) return;
                inp.value = "";
                hsAsk(t);
            });
            body.append(f);
            const chips = gEl("div", "hs-chips");
            hsIdeas().forEach(q => chips.append(gBtn(q, "g-chip", () => { inp.value = q; inp.focus(); })));
            body.append(chips, gEl("p", "g-info", "3 questions each per turn"));
        }
        if (host) body.append(gBtn("Skip this turn (host)", "g-ghost", hsSkipTurn));
    } else {
        body.append(gBtn("Next Hot Seat", "g-main", hsNext));
    }

    const info = gEl("div", "g-card");
    info.append(gEl("div", "g-label", "Game info"));
    info.append(gEl("p", "g-info", s.players.length + " players · Round " + (s.round || 1)));
    const r2 = gEl("div", "g-two");
    r2.append(gBtn("Leave game", "g-ghost", hsLeave));
    if (host) r2.append(gBtn("End game", "g-ghost danger", hsEnd));
    info.append(r2);
    body.append(info);

    hsLive();
}

function hsLive() {
    const s = HS.state;
    if (!s || s.status !== "playing") return;
    const seatName = hsPlayer(s, s.seat).n;
    const feed = $("hsFeed");
    if (feed) {
        const stick = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
        feed.innerHTML = "";
        const qs = s.qs || [];
        if (!qs.length) feed.appendChild(gEl("p", "g-wait", "No questions yet. Be the first to ask!"));
        qs.forEach(q => {
            const it = gEl("div", "hs-item");
            const qd = gEl("div", "hs-q");
            qd.append(gEl("b", "", q.n), document.createTextNode(q.t));
            it.append(qd);
            if (q.a) {
                const ad = gEl("div", "hs-a");
                ad.append(gEl("b", "", seatName), document.createTextNode(q.a));
                it.append(ad);
            } else if (q.skip) {
                it.append(gEl("div", "hs-a", "Skipped"));
            }
            feed.append(it);
        });
        if (stick) feed.scrollTop = feed.scrollHeight;
    }
    const cur = $("hsCur");
    if (cur) {
        const q = (s.qs || []).find(x => !x.a && !x.skip);
        cur.textContent = q ? q.n + " asks: " + q.t : "Waiting for questions...";
    }
    hsTick();
}
// Voice Room Leave confirmation
document.addEventListener("click", function (e) {
    const leaveButton = e.target.closest("#vLeave");

    if (!leaveButton) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    const sure = confirm(
        "Leave the Voice Room?\n\nYou can join again anytime."
    );

    if (!sure) return;

    closeVoice();
}, true);
// ============================================================
// MIC ROULETTE
// Random player + randomly generated Gen-Z prompt.
// No AI/API required.
// ============================================================

const MR = {
    room: null,
    key: "",
    state: null,
    rev: 0,
    loaded: false,
    poll: null,
    channel: null,
    tick: null,
    firing: false
};

const MR_SECONDS = 30;

// ------------------------------------------------------------
// Prompt generator
// ------------------------------------------------------------

const MR_ACTIONS = [
    "Tell us",
    "Admit",
    "Reveal",
    "Describe",
    "Explain",
    "Expose",
    "Rate",
    "Give us your most honest take on",
    "Be brutally honest about",
    "Tell the room about"
];

const MR_TOPICS = [
    "your biggest red flag",
    "your biggest ick",
    "your weirdest crush",
    "your most embarrassing moment",
    "the dumbest thing you've done for attention",
    "your most questionable decision",
    "the most embarrassing thing in your camera roll",
    "a lie you've told recently",
    "your worst habit",
    "your most delusional moment",
    "your most chaotic friendship story",
    "the weirdest DM you've ever received",
    "your worst first impression of someone",
    "the most random thing that gives you the ick",
    "something you pretend to like",
    "your most useless talent",
    "your most embarrassing school memory",
    "the cringiest thing you've done to impress someone",
    "your most questionable celebrity crush",
    "the most unhinged thought you've had today",
    "your biggest social media ick",
    "a purchase you instantly regretted",
    "the weirdest thing you've done when nobody was watching"
];

const MR_TWISTS = [
    "and don't lie 👀",
    "and give us the full story.",
    "but you only have 30 seconds 😭",
    "without overthinking it.",
    "be brutally honest.",
    "no safe answers allowed.",
    "and you can't skip the details 💀",
    "without naming anyone.",
    "and everyone gets one follow-up question.",
    "don't censor yourself too much 😭",
    "first answer that comes to mind.",
    "and explain WHY.",
    "no 'I don't know' allowed.",
    "keep it real, bestie.",
    "you have been selected by the universe 💀"
];

const MR_DIRECT = [
    "What's an opinion you know everyone here will disagree with?",
    "Who in this room would survive a zombie apocalypse the longest?",
    "Who here would you trust with your biggest secret?",
    "What's something everyone loves that you absolutely hate?",
    "What's your most controversial harmless opinion?",
    "What's the biggest red flag you would STILL ignore?",
    "What's one thing you'd never post on your main account?",
    "What's the most embarrassing thing you've searched online?",
    "What's a trend you secretly think is cringe?",
    "What's one thing you would never do for a crush?",
    "What's your most irrational fear?",
    "What's one thing your friends always roast you for?",
    "What's the most delusional thing you've ever believed?",
    "What's your biggest 'why did I do that?' moment?",
    "What's a green flag that instantly gets your attention?",
    "What's the pettiest reason you've ever disliked someone?",
    "What's one secret talent you have?",
    "What's something about you people always assume incorrectly?",
    "What's the funniest lie you've told to get out of something?",
    "What's your most chaotic late-night decision?"
];

function mrRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function mrMakePrompt(history) {
    const old = new Set((history || []).slice(-25));

    for (let i = 0; i < 40; i++) {
        let text;

        if (Math.random() < 0.38) {
            text = mrRandom(MR_DIRECT);
        } else {
            text =
                mrRandom(MR_ACTIONS) +
                " " +
                mrRandom(MR_TOPICS) +
                " " +
                mrRandom(MR_TWISTS);
        }

        text = text.trim();

        if (!old.has(text)) {
            return text;
        }
    }

    return mrRandom(MR_DIRECT);
}

// ------------------------------------------------------------
// Player helpers
// ------------------------------------------------------------

function mrMe() {
    return {
        u: myProfile.username,
        n: myProfile.username,
        a: myProfile.avatar_url || myProfile.avatar || null
    };
}

function mrPlayer(s, username) {
    return (s.players || []).find(p => p.u === username) ||
        { u: username, n: username, a: null };
}

function mrPickNext(s) {
    const players = s.players || [];

    if (players.length < 2) return null;

    s.counts = s.counts || {};

    const previous = s.turn;

    if (previous) {
        s.counts[previous] = (s.counts[previous] || 0) + 1;
    }

    // Prefer players who have had fewer turns.
    const min = Math.min(
        ...players.map(p => s.counts[p.u] || 0)
    );

    let pool = players.filter(
        p => (s.counts[p.u] || 0) === min
    );

    // Avoid immediately picking the same person.
    if (pool.length > 1 && previous) {
        const withoutPrevious = pool.filter(
            p => p.u !== previous
        );

        if (withoutPrevious.length) {
            pool = withoutPrevious;
        }
    }

    const next = mrRandom(pool);

    s.turn = next.u;
    s.round = (s.round || 0) + 1;
    s.phase = "prompt";
    s.prompt = mrMakePrompt(s.history || []);
    s.history = [
        ...(s.history || []),
        s.prompt
    ].slice(-40);

    s.endsAt = Date.now() + MR_SECONDS * 1000;
    s.answer = null;

    return next;
}

// ------------------------------------------------------------
// Database helpers
// ------------------------------------------------------------

async function mrGet() {
    if (!MR.room) return null;

    const { data, error } =
        await supabaseClient.rpc("game_get", {
            p_room: MR.key
        });

    if (error) {
        console.error("Mic Roulette get:", error);
        return null;
    }

    const r = data && data[0];

    if (!r) {
        return {
            state: null,
            rev: 0
        };
    }

    return {
        state: r.state,
        rev: r.rev
    };
}

async function mrSet(state, rev) {
    if (!MR.room) return false;

    const { data, error } =
        await supabaseClient.rpc("game_set", {
            p_room: MR.key,
            p_game: "mic",
            p_state: state,
            p_expected: rev
        });

    if (error) {
        console.error("Mic Roulette set:", error);
        return false;
    }

    return !!data;
}

async function mrMutate(fn) {
    const row = await mrGet();

    if (!row) return false;

    const current =
        row.state && row.state.status
            ? JSON.parse(JSON.stringify(row.state))
            : null;

    const next = fn(current);

    if (!next) {
        mrApply(row, true);
        return false;
    }

    const ok = await mrSet(next, row.rev);

    if (ok) {
        mrApply({
            state: next,
            rev: row.rev + 1
        }, true);

        return true;
    }

    const latest = await mrGet();

    if (latest) {
        mrApply(latest, true);
    }

    return false;
}

// ------------------------------------------------------------
// Game actions
// ------------------------------------------------------------

function mrCreate() {
    mrMutate(() => ({
        game: "mic",
        status: "lobby",
        host: myProfile.username,
        players: [mrMe()],
        counts: {},
        history: [],
        round: 0,
        turn: null,
        phase: "lobby",
        prompt: null,
        answer: null,
        endsAt: null
    }));
}

function mrJoin() {
    mrMutate(s => {
        if (!s) return null;

        if (
            s.status !== "lobby" &&
            s.status !== "playing"
        ) {
            return null;
        }

        if (!s.players.some(
            p => p.u === myProfile.username
        )) {
            s.players.push(mrMe());
        }

        return s;
    });
}

function mrStart() {
    mrMutate(s => {
        if (!s) return null;

        if (
            s.status !== "lobby" ||
            s.host !== myProfile.username ||
            s.players.length < 2
        ) {
            return null;
        }

        s.status = "playing";
        s.counts = {};
        s.history = [];
        s.round = 0;

        mrPickNext(s);

        return s;
    });
}

function mrLeave() {
    mrMutate(s => {
        if (!s) return null;

        const me = myProfile.username;

        s.players = s.players.filter(
            p => p.u !== me
        );

        if (!s.players.length) {
            s.status = "ended";
            return s;
        }

        if (s.host === me) {
            s.host = s.players[0].u;
        }

        if (s.players.length < 2) {
            s.status = "lobby";
            s.turn = null;
            s.prompt = null;
            s.phase = "lobby";
            s.endsAt = null;
        }

        return s;
    });
}

function mrEnd() {
    mrMutate(s => {
        if (!s) return null;

        if (s.host !== myProfile.username) {
            return null;
        }

        s.status = "ended";
        s.phase = "ended";
        s.endsAt = null;

        return s;
    });
}

function mrNext() {
    mrMutate(s => {
        if (!s || s.status !== "playing") return null;

        mrPickNext(s);

        return s;
    });
}

// ------------------------------------------------------------
// Timer
// ------------------------------------------------------------

function mrTick() {
    if (
        G.view !== "mic" ||
        !MR.state ||
        MR.state.status !== "playing" ||
        MR.state.phase !== "prompt" ||
        !MR.state.endsAt
    ) {
        return;
    }

    const left =
        MR.state.endsAt - Date.now();

    const timer = $("mrTimer");

    if (timer) {
        timer.textContent =
            Math.max(
                0,
                Math.ceil(left / 1000)
            ) + "s";
    }

    const bar = $("mrBar");

    if (bar) {
        const percent =
            Math.max(
                0,
                Math.min(
                    100,
                    (left / (MR_SECONDS * 1000)) * 100
                )
            );

        bar.style.width = percent + "%";
    }

    if (
        left <= 0 &&
        !MR.firing
    ) {
        MR.firing = true;

        mrMutate(s => {
            if (
                !s ||
                s.status !== "playing" ||
                s.phase !== "prompt"
            ) {
                return null;
            }

            mrPickNext(s);

            return s;
        }).finally(() => {
            MR.firing = false;
        });
    }
}

// ------------------------------------------------------------
// Sync
// ------------------------------------------------------------

function mrStartSync() {
    mrStopSync();

    MR.channel =
        supabaseClient
            .channel("mic-" + MR.key)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "room_games",
                    filter: "room_id=eq." + MR.key
                },
                p => {
                    const r = p.new;

                    if (r && r.state) {
                        mrApply({
                            state: r.state,
                            rev: r.rev
                        });
                    }
                }
            )
            .subscribe();

    MR.poll = setInterval(async () => {
        if (
            !currentRoom ||
            G.view !== "mic"
        ) {
            mrStopSync();
            return;
        }

        const row = await mrGet();

        if (row) {
            mrApply(row);
        }
    }, 3000);

    MR.tick = setInterval(
        mrTick,
        500
    );
}

function mrStopSync() {
    if (MR.poll) {
        clearInterval(MR.poll);
        MR.poll = null;
    }

    if (MR.tick) {
        clearInterval(MR.tick);
        MR.tick = null;
    }

    if (MR.channel) {
        supabaseClient.removeChannel(
            MR.channel
        );

        MR.channel = null;
    }
}

function mrApply(row, force) {
    if (!row) return;

    if (
        !force &&
        MR.loaded &&
        row.rev <= MR.rev
    ) {
        return;
    }

    MR.loaded = true;
    MR.state =
        row.state &&
        row.state.status
            ? row.state
            : null;

    MR.rev = row.rev;

    mrRender();
}

// ------------------------------------------------------------
// UI
// ------------------------------------------------------------

function mrPlayerRow(p, tag) {
    const row =
        gEl("div", "g-prow");

    const av =
        gEl("div", "g-av");

    paintAvatar(
        av,
        p.a,
        p.n
    );

    row.append(
        av,
        gEl(
            "strong",
            "",
            p.n
        )
    );

    if (tag) {
        row.append(
            gEl(
                "span",
                "g-tag",
                tag
            )
        );
    }

    return row;
}

function mrRender() {
    const body = $("gBody");

    if (
        !body ||
        G.view !== "mic" ||
        !myProfile
    ) {
        return;
    }

    body.innerHTML = "";

    const s = MR.state;
    const me = myProfile.username;

    // --------------------------------------------------------
    // No game
    // --------------------------------------------------------

    if (
        !s ||
        s.status === "ended"
    ) {
        const card =
            gEl("div", "g-card");

        card.append(
            gEl(
                "div",
                "g-label",
                "🎙️ Mic Roulette"
            ),
            gEl(
                "p",
                "g-info",
                "Everyone gets a chance. One player is picked at random and gets a surprise prompt. You have 30 seconds. 🎙️"
            )
        );

        body.append(
            card,
            gBtn(
                "Create game",
                "g-main",
                mrCreate
            )
        );

        return;
    }

    // --------------------------------------------------------
    // Lobby
    // --------------------------------------------------------

    if (s.status === "lobby") {
        const card =
            gEl("div", "g-card");

        card.append(
            gEl(
                "div",
                "g-label",
                "Players (" +
                s.players.length +
                ")"
            )
        );

        s.players.forEach(p => {
            card.append(
                mrPlayerRow(
                    p,
                    p.u === s.host
                        ? "Host"
                        : ""
                )
            );
        });

        body.append(card);

        const joined =
            s.players.some(
                p => p.u === me
            );

        if (!joined) {
            body.append(
                gBtn(
                    "Join game",
                    "g-main",
                    mrJoin
                )
            );
        } else if (
            s.host === me
        ) {
            const start =
                gBtn(
                    s.players.length < 2
                        ? "Need 2+ players"
                        : "Start Roulette 🎙️",
                    "g-main",
                    mrStart
                );

            if (
                s.players.length < 2
            ) {
                start.disabled = true;
            }

            body.append(
                start,
                gBtn(
                    "Cancel game",
                    "g-ghost",
                    mrEnd
                )
            );
        } else {
            body.append(
                gEl(
                    "p",
                    "g-wait",
                    "Waiting for the host to start..."
                ),
                gBtn(
                    "Leave",
                    "g-ghost",
                    mrLeave
                )
            );
        }

        return;
    }

    // --------------------------------------------------------
    // Playing
    // --------------------------------------------------------

    const player =
        mrPlayer(
            s,
            s.turn
        );

    const mine =
        s.turn === me;

    const card =
        gEl(
            "div",
            "g-card"
        );

    card.append(
        gEl(
            "div",
            "g-label",
            "🎙️ Mic Roulette"
        )
    );

    const turnRow =
        gEl(
            "div",
            "g-turnrow"
        );

    const av =
        gEl(
            "div",
            "g-av big"
        );

    paintAvatar(
        av,
        player.a,
        player.n
    );

    const text =
        gEl(
            "div",
            "g-turntext"
        );

    text.append(
        gEl(
            "strong",
            "",
            player.n
        ),
        gEl(
            "span",
            "",
            mine
                ? "YOU GOT PICKED 😭"
                : "You're up 👀"
        )
    );

    turnRow.append(
        av,
        text
    );

    card.append(turnRow);

    body.append(card);

    // Prompt
    if (s.prompt) {
        const promptCard =
            gEl(
                "div",
                "g-card g-prompt"
            );

        promptCard.append(
            gEl(
                "span",
                "g-badge",
                mine
                    ? "YOUR PROMPT"
                    : "THE PROMPT"
            ),
            gEl(
                "div",
                "g-ptxt",
                s.prompt
            )
        );

        body.append(promptCard);
    }

    // Timer
    const timerCard =
        gEl(
            "div",
            "g-card"
        );

    timerCard.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
        '<span class="g-label">TIME</span>' +
        '<strong id="mrTimer">30s</strong>' +
        '</div>' +
        '<div style="height:7px;background:rgba(255,255,255,.10);border-radius:99px;overflow:hidden;margin-top:10px;">' +
        '<div id="mrBar" style="height:100%;width:100%;transition:width .4s;"></div>' +
        '</div>';

    body.append(timerCard);

    if (mine) {
        body.append(
            gBtn(
                "I'm done 😭",
                "g-main",
                mrNext
            )
        );
    }

    if (s.host === me) {
        body.append(
            gBtn(
                "Skip this turn",
                "g-ghost",
                mrNext
            ),
            gBtn(
                "End game",
                "g-ghost",
                mrEnd
            )
        );
    }
}

// ------------------------------------------------------------
// Open Mic Roulette
// ------------------------------------------------------------

async function openMicRoulette() {
    G.view = "mic";

    MR.room = currentRoom;
    MR.key =
        String(currentRoom.id) +
        "_mic";

    MR.loaded = false;
    MR.state = null;
    MR.rev = 0;
    MR.firing = false;

    $("gTitle").textContent =
        "Mic Roulette";

    $("gFoot").classList.add(
        "hidden"
    );

    $("gBody").innerHTML = "";

    $("gBody").appendChild(
        gEl(
            "p",
            "g-sub",
            "Loading..."
        )
    );

    const row = await mrGet();

    if (!row) {
        $("gBody").innerHTML =
            '<p class="g-sub">Could not load Mic Roulette.</p>';

        return;
    }

    mrApply(row, true);
    mrStartSync();
}
// ================================
// CHAT PINS + FULL-PAGE REQUESTS/NOTIFICATIONS + SPEAKING APPROVAL
// Paste at the very end of auth.js
// ================================

// ---------- pinned chats (max 3) ----------
const PIN_SVG = '<svg viewBox="0 0 24 24"><path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3z"/></svg>';
let pinMap = {};

async function loadPins() {
    const { data } = await supabaseClient.rpc("my_pins");
    pinMap = {};
    (data || []).forEach(p => { pinMap[String(p.room_id)] = p.pinned_at; });
}

async function togglePin(room) {
    const id = String(room.id);
    const { data, error } = await supabaseClient.rpc("pin_chat", { p_room: id, p_pin: !pinMap[id] });
    if (error) { console.error(error); gToast("Could not update the pin"); return; }
    if (data === "limit") { gToast("You can pin up to 3 chats"); return; }
    await loadPins();
    loadChats();
}

function openChatRowMenu(room) {
    const dm = dmOf(room);
    const title = dm ? (dm.display_name || dm.username) : (room.room_name || "Room");
    const pinned = !!pinMap[String(room.id)];
    const items = [[pinned ? "Unpin chat" : "Pin chat", () => togglePin(room)]];
    if (dm) {
        items.push([blockedNames.has(dm.username) ? "Unblock" : "Block", () => toggleBlock(dm), true]);
        items.push(["Delete chat", async () => { await deleteChatForMe(room); loadChats(); }, true]);
    } else {
        items.push(["Delete chat", async () => { await deleteChatForMe(room); loadChats(); }, true]);
        items.push(["Leave room", async () => { await leaveRoom(room); loadChats(); }, true]);
    }
    items.push(["Cancel", () => {}]);
    showSheet(items, title);
}

async function loadChats() {
    const list = $("chatsList");
    const [r1, r2] = await Promise.all([
        supabaseClient.rpc("my_rooms"),
        supabaseClient.rpc("my_unread")
    ]);

    if (r1.error) {
        console.error(r1.error);
        list.innerHTML = '<p class="empty">Could not load chats.</p>';
        return;
    }

    await loadDmMap();
    try { await loadChatExtras(); } catch (e) { console.error(e); }
    try { await loadPins(); } catch (e) { console.error(e); }

    const unread = {};
    (r2.data || []).forEach(u => { unread[u.room_id] = Number(u.n); });

    const all = r1.data || [];
    const reqs = all.filter(isIncomingReq);
    let rooms = all.filter(r => !isIncomingReq(r) && !isClearedEmpty(r));

    // Pinned chats first (most recently pinned on top); everything else keeps its order
    const pinTime = r => pinMap[String(r.id)] ? new Date(pinMap[String(r.id)]).getTime() : 0;
    rooms = rooms.map((r, i) => ({ r, i }))
        .sort((a, b) => (pinTime(b.r) - pinTime(a.r)) || (a.i - b.i))
        .map(x => x.r);

    list.innerHTML = "";

    // "Message requests" row opens its own page
    const rr = document.createElement("div");
    rr.className = "chat-row";
    const rav = document.createElement("div");
    rav.className = "room-avatar";
    rav.textContent = "✉️";
    const rtext = document.createElement("div");
    rtext.className = "chat-row-text";
    const rt = document.createElement("strong");
    rt.textContent = "Message requests";
    const rs = document.createElement("span");
    rs.textContent = reqs.length ? reqs.length + " new" : "No new requests";
    rtext.append(rt, rs);
    rr.append(rav, rtext);
    if (reqs.length) {
        const b = document.createElement("span");
        b.className = "unread-badge";
        b.textContent = reqs.length;
        rr.appendChild(b);
    }
    rr.addEventListener("click", openRequests);
    list.appendChild(rr);

    if (!rooms.length) {
        const p = document.createElement("p");
        p.className = "empty";
        p.textContent = "No chats yet. Create or join a room from the Rooms tab.";
        list.appendChild(p);
        return;
    }

    rooms.forEach(room => {
        try {
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
            text.append(title, preview);
            row.append(av, text);

            if (pinMap[String(room.id)]) {
                const pin = document.createElement("span");
                pin.className = "pin-ic";
                pin.innerHTML = PIN_SVG;
                row.appendChild(pin);
            }

            const n = unread[String(room.id)];
            if (n) {
                const b = document.createElement("span");
                b.className = "unread-badge";
                b.textContent = n > 99 ? "99+" : n;
                row.appendChild(b);
            }

            list.appendChild(row);

            row.addEventListener("click", () => {
                currentRoom = room;
                currentUser = myProfile.username;
                openChat();
            });
            try { attachRowMenu(row, room); } catch (e) { console.error(e); }

            supabaseClient
                .from("messages")
                .select("message,audio_url,media_url,username")
                .eq("room_id", room.id)
                .gt("created_at", clearedMap[String(room.id)] || "1970-01-01T00:00:00Z")
                .order("created_at", { ascending: false })
                .limit(1)
                .then(({ data: last }) => {
                    const m = last && last[0];
                    if (!m) { preview.textContent = "No messages yet"; return; }
                    const body = m.audio_url ? "Voice message" : m.media_url ? "Photo/Video" : m.message;
                    preview.textContent =
                        (m.username === myProfile.username ? "You: " : m.username + ": ") + body;
                })
                .catch(() => { preview.textContent = ""; });
        } catch (e) {
            console.error("chat row failed", e);
        }
    });
}

// ---------- full-page screens (replace the old popups) ----------
function openSubPage(id, title, onClose) {
    const old = $(id);
    if (old) old.remove();
    const p = document.createElement("div");
    p.id = id;
    p.className = "subpage";
    p.innerHTML =
        '<header class="sp-top">' +
            '<button type="button" class="hdr-btn sp-back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>' +
            '<strong></strong><span class="sp-gap"></span>' +
        '</header><div class="sp-body"></div>';
    p.querySelector("strong").textContent = title;
    p.querySelector(".sp-back").addEventListener("click", () => {
        p.remove();
        if (onClose) onClose();
    });
    document.body.appendChild(p);
    return p;
}

async function openRequests() {
    const page = openSubPage("reqPage", "Message requests", () => loadChats());
    page.querySelector(".sp-body").innerHTML =
        '<p class="sp-note">People who are not your friends show up here until you accept.</p>' +
        '<div id="reqList"></div>';
    renderRequests(page);
}

async function openNotifications() {
    const page = openSubPage("notifPage", "Notifications", () => refreshBell());
    const box = page.querySelector(".sp-body");
    box.innerHTML = '<p class="empty">Loading...</p>';

    const { data, error } = await supabaseClient.rpc("my_notifications");
    box.innerHTML = "";
    if (error) {
        console.error(error);
        box.innerHTML = '<p class="empty">Could not load notifications.</p>';
        return;
    }
    const list = data || [];
    if (!list.length) {
        box.innerHTML = '<p class="empty">No notifications yet.</p>';
    }

    const texts = {
        friend_request: " sent you a friend request",
        friend_accepted: " accepted your friend request",
        dm_request: " sent you a message request",
        dm_accepted: " accepted your message request"
    };

    list.forEach(n => {
        const row = document.createElement("div");
        row.className = "member-row notif-row" + (n.is_read ? "" : " unread");
        row.style.cursor = "pointer";

        const av = document.createElement("div");
        av.className = "member-av";
        paintAvatar(av, n.avatar_url, n.display_name || n.username);

        const txt = document.createElement("div");
        txt.className = "member-text";
        const name = document.createElement("strong");
        name.textContent = n.display_name || n.username || "Someone";
        const sub = document.createElement("span");
        sub.textContent = (texts[n.kind] || "").trim() + " · " + timeAgo(n.created_at);
        txt.append(name, sub);
        row.append(av, txt);

        row.addEventListener("click", async () => {
            page.remove();
            if (n.kind === "dm_request") {
                openRequests();
            } else if (n.kind === "dm_accepted") {
                const { data: rs } = await supabaseClient.rpc("my_rooms");
                const room = (rs || []).find(r => String(r.id) === String(n.room_id));
                if (room) {
                    currentRoom = room;
                    currentUser = myProfile.username;
                    await loadDmMap();
                    openChat();
                }
            } else if (n.username) {
                openUserProfile(n.username);
            }
        });
        box.appendChild(row);
    });

    await supabaseClient.rpc("mark_notifs_read");
    refreshBell();
}

// ---------- voice room: speaking approval (raise hand -> host allows) ----------
const VCARD = {};   // username -> time until which the host's card stays hidden

function micNeedsApproval() {
    if (!vState || isHost()) return false;
    const h = vUsers().find(u => u.username === vHost);
    return !!(h && h.approve);
}

function vInitApproval() {
    if (!vState || !vRoom || !vHost || vState.apInit) return;
    vState.apInit = true;
    if (isHost()) {
        let on = false;
        try { on = localStorage.getItem("approve_" + vRoom.id) === "1"; } catch (e) {}
        vState.approve = on;
    }
    vTrack();
}

function toggleApproval() {
    if (!isHost()) return;
    vState.approve = !vState.approve;
    try { localStorage.setItem("approve_" + vRoom.id, vState.approve ? "1" : ""); } catch (e) {}
    vTrack();
    renderVoice();
    gToast(vState.approve
        ? "Approval is ON. Members must raise a hand to speak."
        : "Approval is OFF. Anyone on a seat can speak.");
}

function vAllow(username) {
    rtcSend(username, "allow", {});
    VCARD[username] = Date.now() + 5000;
    setTimeout(renderVoice, 5200);
    renderVoice();
}
function vDecline(username) {
    rtcSend(username, "decline", {});
    VCARD[username] = Date.now() + 5000;
    setTimeout(renderVoice, 5200);
    renderVoice();
}

// Messages from the host, received through the existing signalling channel
function vOnAllow() {
    if (!vState || vState.seat === null) return;
    vState.allowed = true;
    vState.hand = false;
    vTrack();
    renderVoice();
    gToast("The host allowed you to speak");
    if (vState.muted) {
        startMic().then(ok => {
            if (ok && vState) { vState.muted = false; vTrack(); renderVoice(); }
        });
    }
}
function vOnDecline() {
    if (!vState) return;
    vState.hand = false;
    vTrack();
    renderVoice();
    gToast("The host declined your request");
}
function vOnForceMute() {
    if (!vState) return;
    vState.muted = true;
    vState.allowed = false;
    vState.hand = false;
    stopMic();
    vTrack();
    renderVoice();
}

const _rtcHandle0 = (typeof rtcHandle === "function") ? rtcHandle : async function () {};
rtcHandle = async function (p) {
    if (p && vState && p.to === vState.username &&
        (p.kind === "allow" || p.kind === "decline" || p.kind === "force_mute")) {
        if (p.from !== vHost) return;   // only the host may send these
        if (p.kind === "allow") vOnAllow();
        else if (p.kind === "decline") vOnDecline();
        else vOnForceMute();
        return;
    }
    return _rtcHandle0(p);
};

async function toggleMic() {
    if (!vState) return;
    if (vState.seat === null) {
        alert("Take a seat first to use the mic.");
        return;
    }
    if (vState.muted) {
        if (micNeedsApproval() && !vState.allowed) {
            if (!vState.hand) { vState.hand = true; vTrack(); renderVoice(); }
            gToast("Hand raised. The host needs to allow you to speak.");
            return;
        }
        const ok = await startMic();
        if (!ok) return;
        vState.muted = false;
    } else {
        vState.muted = true;
        if (micNeedsApproval()) vState.allowed = false;   // the speaking turn is over
        stopMic();
    }
    vTrack();
    renderVoice();
}

function leaveSeat() {
    if (!vState) return;
    vState.seat = null;
    vState.seatAt = 0;
    vState.muted = true;
    vState.hand = false;
    vState.allowed = false;
    vState.speaking = false;
    vTrack();
    renderVoice();
}

function onSeatTap(i, u) {
    if (!u) { takeSeat(i); return; }

    if (u.username === vState.username) {
        showSheet([
            [vState.muted ? "Unmute mic" : "Mute mic", toggleMic],
            ["Leave seat", leaveSeat, true],
            ["Cancel", () => {}]
        ], "My seat");
        return;
    }

    const items = [["View profile", () => openUserProfile(u.username)]];
    if (isHost()) {
        if (u.hand) items.push(["Allow to speak", () => vAllow(u.username)]);
        if (!u.muted) items.push(["Mute", () => rtcSend(u.username, "force_mute", {}), true]);
        items.push(["Remove from seat", () => {
            vChannel.send({ type: "broadcast", event: "kick", payload: { username: u.username } });
        }, true]);
    }
    items.push(["Cancel", () => {}]);
    showSheet(items, u.name || u.username);
}

function openVoiceMenu() {
    const items = [];
    if (isHost()) {
        if (typeof openSeatLayout === "function") items.push(["Seat layout", openSeatLayout]);
        items.push([
            vState.approve ? "Speaking approval: ON (tap to turn off)" : "Speaking approval: OFF (tap to turn on)",
            toggleApproval
        ]);
        items.push(["Mute everyone", () => {
            vChannel.send({ type: "broadcast", event: "mute_all", payload: {} });
        }]);
    }
    items.push(["Room info", openRoomInfo]);
    items.push(["Members", showMembers]);
    if (isHost()) items.push(["Edit name & photo", openEditRoom]);
    items.push(["Leave room permanently", leaveVoiceMembership, true]);
    items.push(["Cancel", () => {}]);
    showSheet(items, "Room menu");
}

// The host sees one card per raised hand: "Sara wants to speak  [Allow] [Decline]"
function vRenderCards() {
    if (!$("voicePage") || !vState || !$("vChat")) return;
    let box = $("vCards");
    if (!box) {
        box = document.createElement("div");
        box.id = "vCards";
        box.className = "v-cards";
        $("vChat").before(box);
    }
    box.innerHTML = "";
    if (!isHost() || !vState.approve) return;

    const now = Date.now();
    const asking = vUsers().filter(u =>
        u.username !== vState.username && u.hand && u.seat !== null && !u.allowed && !(VCARD[u.username] > now));

    asking.slice(0, 3).forEach(u => {
        const card = document.createElement("div");
        card.className = "v-ask";
        const av = document.createElement("div");
        av.className = "v-ask-av";
        paintAvatar(av, u.avatar, u.name || u.username);
        const tx = document.createElement("span");
        tx.className = "v-ask-tx";
        tx.textContent = (u.name || u.username) + " wants to speak";
        const ok = document.createElement("button");
        ok.type = "button";
        ok.className = "v-ask-ok";
        ok.textContent = "Allow";
        ok.addEventListener("click", () => vAllow(u.username));
        const no = document.createElement("button");
        no.type = "button";
        no.className = "v-ask-no";
        no.textContent = "Decline";
        no.addEventListener("click", () => vDecline(u.username));
        card.append(av, tx, ok, no);
        box.appendChild(card);
    });
}

const _renderVoice5 = renderVoice;
renderVoice = function () {
    _renderVoice5();
    try { vInitApproval(); vRenderCards(); } catch (e) { console.error(e); }
};
// ================================
// VOICE PRESENCE RECOVERY
// After the app was in the background (app switch / screen lock), reconnect and
// announce the real seat, hand and mic state again.
// ================================
async function vRecover() {
    if (!vChannel || !vState || !vRoom) return;
    try {
        if (supabaseClient.realtime && !supabaseClient.realtime.isConnected()) {
            supabaseClient.realtime.connect();
        }
    } catch (e) {}
    try { await vChannel.track(vState); } catch (e) { console.error("re-track", e); }
    renderVoice();
    rtcSync();
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) setTimeout(vRecover, 400); });
window.addEventListener("focus", () => setTimeout(vRecover, 400));
window.addEventListener("online", () => setTimeout(vRecover, 800));

// Safety net: re-announce my state every 15 seconds while the room is open and visible
setInterval(() => {
    if (vChannel && vState && !document.hidden) {
        try { vChannel.track(vState); } catch (e) {}
    }
}, 15000);
// ================================
// PROFILE v2: banner, themes, favourite song, joined date, friends-only extras
// Paste at the very end of auth.js
// ================================

function ptSafeUrl(u) {
    u = String(u || "").trim();
    return /^(https?:|blob:)[^\s"'()<>\\]+$/i.test(u) ? u : "";
}
function ptSafeLink(u) {
    u = String(u || "").trim();
    return /^https?:\/\/[^\s"'<>\\]+$/i.test(u) ? u : "";
}

const PT_ICONS = {
    cal: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
    note: '<svg viewBox="0 0 24 24"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg>',
    more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>'
};

// ---------- decorations drawn on the banner ----------
const PT_SYM = {
    heart: '<path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z"/>',
    star: '<path d="M12 2l2.9 6.9L22 10l-5.5 4.8L18 22l-6-3.6L6 22l1.5-7.2L2 10l7.1-1.1z"/>',
    sparkle: '<path d="M12 1c.9 6 5 10.1 11 11-6 .9-10.1 5-11 11-.9-6-5-10.1-11-11 6-.9 10.1-5 11-11z"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 7 7 0 0 0 20 14.5z"/>',
    clover: '<circle cx="8.5" cy="8.5" r="4.5"/><circle cx="15.5" cy="8.5" r="4.5"/><circle cx="8.5" cy="15.5" r="4.5"/><circle cx="15.5" cy="15.5" r="4.5"/>',
    butterfly: '<path d="M12 12C9 3 2 5 3 11s6 8 9 1z"/><path d="M12 12c3-9 10-7 9-1s-6 8-9 1z"/>'
};

function ptDeco(syms, fill) {
    // [symbol index, x, y, scale, rotation, opacity]
    const spots = [
        [0, 330, 14, 1.5, 12, .55], [1, 60, 26, 1.0, -10, .5], [0, 250, 78, 0.9, 0, .35],
        [1, 150, 16, .8, 15, .5], [0, 18, 96, 1.1, -15, .35], [1, 366, 92, .9, 0, .5],
        [0, 190, 104, .7, 10, .3], [1, 300, 108, 1.0, 0, .4]
    ];
    const body = spots.map(([k, x, y, s, r, o]) =>
        '<g transform="translate(' + x + ' ' + y + ') rotate(' + r + ') scale(' + (s * 1.6) + ')" fill="' +
        fill + '" opacity="' + o + '">' + PT_SYM[syms[k]] + '</g>'
    ).join("");
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 150" preserveAspectRatio="xMidYMid slice">' + body + '</svg>';
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
}

// ---------- the profile themes ----------
const PT_THEMES = {
    pink:   { label: "Pink",   dot: "#F27AA6", bg: "#FFF3F8", card: "#FFFFFF", text: "#4B2338", muted: "#A8788F", accent: "#E8638F", soft: "#FFDCEA", g: ["#FF9EC4", "#FFC9DE", "#FFE6F0"], syms: ["heart", "sparkle"], fill: "#FFFFFF" },
    blue:   { label: "Blue",   dot: "#5AA9F0", bg: "#F0F7FF", card: "#FFFFFF", text: "#1F3552", muted: "#6C86A6", accent: "#3B82F6", soft: "#D8EAFF", g: ["#7DBBFF", "#BFE0FF", "#E8F4FF"], syms: ["butterfly", "sparkle"], fill: "#FFFFFF" },
    purple: { label: "Purple", dot: "#9B7BE8", bg: "#F5F0FF", card: "#FFFFFF", text: "#3F2F6B", muted: "#8F82B8", accent: "#7C5CD6", soft: "#E6DAFF", g: ["#B79BF2", "#D9C8FA", "#EFE8FF"], syms: ["moon", "star"], fill: "#FFFFFF" },
    dark:   { label: "Dark",   dot: "#1B1C21", bg: "#101114", card: "#1B1C21", text: "#F2F2F4", muted: "#9A9AA6", accent: "#F28BB0", soft: "#2A2B33", g: ["#3A2F55", "#2A2540", "#1B1C21"], syms: ["star", "moon"], fill: "#FFFFFF" },
    green:  { label: "Green",  dot: "#6CC07A", bg: "#F1FAF0", card: "#FFFFFF", text: "#2F4A33", muted: "#7A9B7E", accent: "#3FA35A", soft: "#D9F0D9", g: ["#8FD99B", "#C7EBC8", "#EAF8E8"], syms: ["clover", "sparkle"], fill: "#FFFFFF" }
};

function ptTheme(key, accent) {
    if (key !== "custom") return PT_THEMES[key] || PT_THEMES.pink;
    const a = /^#[0-9a-f]{6}$/i.test(accent || "") ? accent : "#C77DFF";
    const mix = p => "color-mix(in srgb, " + a + " " + p + "%, #ffffff)";
    return {
        label: "Custom", dot: a, bg: mix(8), card: "#FFFFFF", text: "#3A2E3A",
        muted: "color-mix(in srgb, " + a + " 45%, #7a6a7a)", accent: a, soft: mix(20),
        g: [mix(80), mix(40), mix(12)], syms: ["heart", "star"], fill: "#FFFFFF"
    };
}

const PT_VARS = ["--pt-bg", "--pt-card", "--pt-text", "--pt-muted", "--pt-accent", "--pt-soft", "--pt-banner"];

// Applies a theme to a page element (pass null to remove it)
function ptApply(el, ex) {
    if (!el) return;
    if (!ex) {
        el.classList.remove("pt");
        PT_VARS.forEach(k => el.style.removeProperty(k));
        return;
    }
    const t = ptTheme(ex.theme, ex.accent);
    const grad = "linear-gradient(180deg," + t.g[0] + "," + t.g[1] + " 65%," + t.g[2] + ")";
    const img = ptSafeUrl(ex.banner_url);
    el.classList.add("pt");
    el.style.setProperty("--pt-bg", t.bg);
    el.style.setProperty("--pt-card", t.card);
    el.style.setProperty("--pt-text", t.text);
    el.style.setProperty("--pt-muted", t.muted);
    el.style.setProperty("--pt-accent", t.accent);
    el.style.setProperty("--pt-soft", t.soft);
    el.style.setProperty("--pt-banner", img
        ? 'url("' + img + '") center / cover no-repeat, ' + grad
        : ptDeco(t.syms, t.fill) + " center / cover no-repeat, " + grad);
}

// ---------- data ----------
async function ptFetch(username) {
    const { data } = await supabaseClient.rpc("profile_extras_of", { p_username: username });
    return (data && data[0]) || null;
}
async function ptJoined(username) {
    const { data } = await supabaseClient.rpc("joined_at", { p_username: username });
    return data ? "Joined " + new Date(data).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "";
}

// ---------- small UI pieces ----------
function ptJoinedEl(text) {
    const d = gEl("div", "pt-joined");
    d.innerHTML = PT_ICONS.cal;
    d.appendChild(document.createTextNode(text));
    return d;
}

function ptSongEl(ex) {
    if (!ex || !ex.song_title) return null;
    const card = gEl("div", "pt-song");
    const cover = gEl("div", "pt-cover");
    cover.innerHTML = PT_ICONS.note;
    const tx = gEl("div", "pt-song-tx");
    tx.append(gEl("strong", "", ex.song_title), gEl("span", "", ex.song_artist || ""));
    card.append(cover, tx);
    const url = ptSafeLink(ex.song_url);
    if (url) {
        const a = gEl("a", "pt-play");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.setAttribute("aria-label", "Open song");
        a.innerHTML = PT_ICONS.play;
        card.appendChild(a);
    }
    return card;
}

// ---------- my own profile (Me tab) ----------
function ptEnsureMore() {
    if ($("pfMore") || !$("menuBtn")) return;
    const menu = $("menuBtn");
    const grp = gEl("div", "pf-btns");
    menu.before(grp);
    const b = gEl("button", "hdr-btn");
    b.id = "pfMore";
    b.type = "button";
    b.title = "Edit profile";
    b.innerHTML = PT_ICONS.more;
    b.addEventListener("click", openEditProfilePage);
    grp.append(b, menu);
}

async function ptRenderMe() {
    const page = $("profilePage");
    const wrap = page && page.querySelector(".pf-wrap");
    if (!wrap || !myProfile) return;

    const [ex, joined] = await Promise.all([ptFetch(myProfile.username), ptJoined(myProfile.username)]);

    ["pfBannerBox", "pfExtraBox"].forEach(id => { const o = $(id); if (o) o.remove(); });
    ptApply(page, ex);

    const head = wrap.querySelector(".pf-head");
    const bio = $("profBio");
    if (!head || !bio) return;

    if (ex) {
        const b = gEl("div", "pt-banner");
        b.id = "pfBannerBox";
        head.before(b);
    }
    const box = gEl("div", "pt-extra");
    box.id = "pfExtraBox";
    if (joined) box.appendChild(ptJoinedEl(joined));
    const song = ptSongEl(ex);
    if (song) box.appendChild(song);
    bio.after(box);
}

const _renderProfile0 = renderProfile;
renderProfile = function () {
    _renderProfile0();
    try { ptEnsureMore(); ptRenderMe(); } catch (e) { console.error(e); }
};

// Every "Edit profile" button/menu item now opens the new full page
document.addEventListener("click", e => {
    if (e.target && e.target.closest && e.target.closest("#editProfileBtn")) {
        e.preventDefault();
        e.stopImmediatePropagation();
        openEditProfilePage();
    }
}, true);

// ---------- somebody else's profile ----------
const _openUserProfile2 = openUserProfile;
openUserProfile = async function (u) {
    await _openUserProfile2(u);
    try { await ptEnhanceUserPage(u); } catch (e) { console.error(e); }
};

async function ptEnhanceUserPage(username) {
    if (!username || isAI(username)) return;
    const page = $("userProfilePage");
    if (!page) return;

    const [ex, joined] = await Promise.all([ptFetch(username), ptJoined(username)]);
    if ($("userProfilePage") !== page) return;   // the page was closed or replaced meanwhile

    ["upBanner", "upExtra"].forEach(id => { const o = $(id); if (o) o.remove(); });
    const head = page.querySelector(".upg-head");
    const bio = page.querySelector(".upg-bio");
    if (!head || !bio) return;

    const self = myProfile && myProfile.username === username;
    ptApply(page, ex);
    if (ex) {
        const b = gEl("div", "pt-banner");
        b.id = "upBanner";
        head.before(b);
    }
    const box = gEl("div", "pt-extra");
    box.id = "upExtra";
    if (joined) box.appendChild(ptJoinedEl(joined));
    const song = ptSongEl(ex);
    if (song) box.appendChild(song);
    if (!ex && !self) box.appendChild(gEl("div", "pt-note", "More on this profile is visible to friends only."));
    bio.after(box);
}

// ---------- the new Edit profile page ----------
function ptCrop(file, w, h, q) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            const c = document.createElement("canvas");
            c.width = w;
            c.height = h;
            const s = Math.max(w / img.width, h / img.height);
            const dw = img.width * s, dh = img.height * s;
            c.getContext("2d").drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
            c.toBlob(b => resolve(b), "image/jpeg", q);
            URL.revokeObjectURL(img.src);
        };
        img.onerror = () => resolve(null);
        img.src = URL.createObjectURL(file);
    });
}

async function openEditProfilePage() {
    if (!myProfile || !authUser) return;
    const ex0 = (await ptFetch(myProfile.username)) || {};
    const st = {
        theme: ex0.theme || "pink",
        accent: ex0.accent || "#C77DFF",
        bannerUrl: ex0.banner_url || null,
        bannerPreview: ex0.banner_url || null,
        bannerBlob: null,
        avatarPreview: myProfile.avatar_url || null,
        avatarBlob: null
    };

    const page = openSubPage("editPage", "Edit profile");
    const body = page.querySelector(".sp-body");
    const saveBtn = gBtn("Save", "sp-save", save);
    page.querySelector(".sp-gap").replaceWith(saveBtn);

    const hiddenFile = () => {
        const f = document.createElement("input");
        f.type = "file";
        f.accept = "image/*";
        f.hidden = true;
        return f;
    };
    const sec = (label, ...kids) => {
        const s = gEl("div", "pe-section");
        if (label) s.append(gEl("div", "pe-label", label));
        s.append(...kids);
        return s;
    };
    const field = (ph, val, max) => {
        const i = gEl("input");
        i.placeholder = ph;
        i.value = val || "";
        i.maxLength = max;
        return i;
    };

    // banner + photo
    const banner = gEl("div", "pt-banner");
    const bFile = hiddenFile();
    const bRow = gEl("div", "pe-btns");
    bRow.append(
        gBtn("Change banner", "pe-btn", () => bFile.click()),
        gBtn("Remove banner", "pe-btn", () => {
            st.bannerBlob = null; st.bannerUrl = null; st.bannerPreview = null; preview();
        }),
        bFile
    );

    const av = gEl("div", "pe-av");
    const aFile = hiddenFile();
    const avRow = gEl("div", "pe-avrow");
    avRow.append(av, gBtn("Change photo", "pe-btn", () => aFile.click()), aFile);

    // text fields
    const nameIn = field("Name", myProfile.display_name || "", 30);
    const bioIn = gEl("textarea", "pe-ta");
    bioIn.placeholder = "Bio";
    bioIn.maxLength = 150;
    bioIn.value = myProfile.bio || "";

    // theme picker
    const sw = gEl("div", "pe-swatches");
    const swBtns = {};
    Object.keys(PT_THEMES).concat("custom").forEach(k => {
        const t = ptTheme(k, st.accent);
        const b = gEl("button", "pe-sw" + (k === "custom" ? " custom" : ""));
        b.type = "button";
        const dot = gEl("span", "pe-dot");
        if (k !== "custom") dot.style.background = t.dot;
        b.append(dot, gEl("span", "", t.label));
        b.addEventListener("click", () => { st.theme = k; preview(); });
        swBtns[k] = b;
        sw.appendChild(b);
    });
    const color = gEl("input", "pe-color");
    color.type = "color";
    color.value = st.accent;
    color.addEventListener("input", () => { st.accent = color.value; preview(); });

    // favourite song
    const songT = field("Song name", ex0.song_title, 60);
    const songA = field("Artist", ex0.song_artist, 60);
    const songL = field("Link (optional, https://...)", ex0.song_url, 300);

    body.append(
        sec("", banner, bRow),
        sec("Photo", avRow),
        sec("Name", nameIn),
        sec("Bio", bioIn),
        sec("Profile theme", sw, color),
        sec("Favourite song", songT, songA, songL),
        gEl("p", "pt-note", "Your banner, theme and song are only visible to your friends.")
    );

    function preview() {
        ptApply(page, { theme: st.theme, accent: st.accent, banner_url: st.bannerPreview });
        paintAvatar(av, st.avatarPreview, nameIn.value || myProfile.username);
        Object.keys(swBtns).forEach(k => swBtns[k].classList.toggle("on", k === st.theme));
        color.style.display = st.theme === "custom" ? "" : "none";
    }
    nameIn.addEventListener("input", preview);

    aFile.addEventListener("change", async () => {
        const f = aFile.files[0];
        aFile.value = "";
        if (!f) return;
        const blob = await ptCrop(f, 256, 256, 0.85);
        if (!blob) { gToast("Could not read that image"); return; }
        st.avatarBlob = blob;
        st.avatarPreview = URL.createObjectURL(blob);
        preview();
    });
    bFile.addEventListener("change", async () => {
        const f = bFile.files[0];
        bFile.value = "";
        if (!f) return;
        const blob = await ptCrop(f, 1200, 400, 0.85);
        if (!blob) { gToast("Could not read that image"); return; }
        st.bannerBlob = blob;
        st.bannerPreview = URL.createObjectURL(blob);
        preview();
    });

    preview();

    async function upload(path, blob) {
        const { error } = await supabaseClient.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg" });
        if (error) throw error;
        return supabaseClient.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    }

    async function save() {
        const title = songT.value.trim();
        const link = songL.value.trim();
        if (link && !ptSafeLink(link)) { alert("The song link must start with https://"); return; }

        saveBtn.disabled = true;
        saveBtn.textContent = "Saving...";
        try {
            let avatarUrl = myProfile.avatar_url || null;
            if (st.avatarBlob) avatarUrl = await upload(authUser.id + "/" + crypto.randomUUID() + ".jpg", st.avatarBlob);

            let bannerUrl = st.bannerUrl;
            if (st.bannerBlob) bannerUrl = await upload(authUser.id + "/banner-" + crypto.randomUUID() + ".jpg", st.bannerBlob);

            const r1 = await supabaseClient.from("profiles").update({
                display_name: nameIn.value.trim() || myProfile.username,
                bio: bioIn.value.trim().slice(0, 150),
                avatar_url: avatarUrl
            }).eq("id", authUser.id);
            if (r1.error) throw r1.error;

            const r2 = await supabaseClient.from("profile_extras").upsert({
                user_id: authUser.id,
                banner_url: bannerUrl,
                theme: st.theme,
                accent: st.theme === "custom" ? st.accent : null,
                song_title: title || null,
                song_artist: title ? (songA.value.trim() || null) : null,
                song_url: title ? (link || null) : null,
                updated_at: new Date().toISOString()
            }, { onConflict: "user_id" });
            if (r2.error) throw r2.error;

            await loadProfile();
            renderProfile();
            page.remove();
            gToast("Profile saved");
        } catch (e) {
            console.error(e);
            alert("Could not save: " + (e.message || e));
            saveBtn.disabled = false;
            saveBtn.textContent = "Save";
        }
    }
}
// ================================
// IN-APP SONG CLIPS (YouTube embed, no redirect)
// Overrides ptSongEl and openEditProfilePage
// ================================
const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function ytId(u) {
    u = String(u || "").trim();
    const m = u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/)|music\.youtube\.com\/watch\?(?:[^#]*&)?v=)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : "";
}
function ytTime(s) {
    s = Math.max(0, Math.floor(s || 0));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

let ytReady = null;
function ytLoad() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    if (ytReady) return ytReady;
    ytReady = new Promise((resolve, reject) => {
        const prev = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(); };
        const s = document.createElement("script");
        s.src = "https://www.youtube.com/iframe_api";
        s.onerror = () => { ytReady = null; reject(new Error("player failed to load")); };
        document.head.appendChild(s);
    });
    return ytReady;
}

const YTP = { player: null, back: null };

function ytClose() {
    if (YTP.player) { try { YTP.player.destroy(); } catch (e) {} YTP.player = null; }
    if (YTP.back) { YTP.back.remove(); YTP.back = null; }
}

// o: { vid, start, len, title, artist, pick, onPick(seconds), onInfo({title, author}) }
async function openSongSheet(o) {
    if (!YT_ID_RE.test(o.vid || "")) { gToast("This song link is not valid"); return; }
    ytClose();
    const start = Math.max(0, Math.floor(o.start || 0));
    const len = o.len || 30;

    const back = gEl("div", "yt-back");
    const sheet = gEl("div", "yt-sheet");
    const head = gEl("div", "yt-head", o.pick ? "Pick the part" : "Now playing");
    const sub = gEl("p", "yt-sub", o.pick
        ? "Play the song, then tap 'Start clip here' at the part you love."
        : ((o.title || "") + (o.artist ? " · " + o.artist : "")));
    const box = gEl("div", "yt-box");
    const host = gEl("div");
    host.id = "ytHost";
    box.appendChild(host);
    const row = gEl("div", "yt-row");
    sheet.append(head, sub, box, row);
    back.appendChild(sheet);
    back.addEventListener("click", e => { if (e.target === back) ytClose(); });
    document.body.appendChild(back);
    YTP.back = back;

    try {
        await ytLoad();
    } catch (e) {
        sub.textContent = "Could not load the player. Check your internet.";
        row.append(gBtn("Close", "yt-btn", ytClose));
        return;
    }
    if (YTP.back !== back) return;   // closed while loading

    let mainBtn;
    if (o.pick) {
        mainBtn = gBtn("Start clip here", "yt-btn main", () => {
            let t = 0;
            try { t = Math.floor(YTP.player.getCurrentTime()); } catch (e) {}
            if (o.onPick) o.onPick(t);
            ytClose();
            gToast("Clip starts at " + ytTime(t));
        });
    } else {
        mainBtn = gBtn("Replay", "yt-btn main", () => {
            try { YTP.player.loadVideoById({ videoId: o.vid, startSeconds: start, endSeconds: start + len }); } catch (e) {}
        });
    }
    row.append(mainBtn, gBtn("Close", "yt-btn", ytClose));

    let gotInfo = false;
    const vars = { playsinline: 1, controls: 1, rel: 0, modestbranding: 1, fs: 0, start };
    if (!o.pick) vars.end = start + len;

    YTP.player = new YT.Player("ytHost", {
        width: "100%",
        height: "220",
        videoId: o.vid,
        playerVars: vars,
        events: {
            onReady: e => { try { e.target.playVideo(); } catch (x) {} },
            onStateChange: e => {
                if (e.data === 1 && !gotInfo) {
                    gotInfo = true;
                    try {
                        const d = e.target.getVideoData();
                        if (o.onInfo && d) o.onInfo({ title: d.title, author: d.author });
                    } catch (x) {}
                }
            },
            onError: () => {
                sub.textContent = "This song can't be played here. Try another link.";
            }
        }
    });
}

// ---------- song card on profiles (plays inside the app) ----------
function ptSongEl(ex) {
    if (!ex || !ex.song_title) return null;
    const vid = YT_ID_RE.test(ex.song_vid || "") ? ex.song_vid : "";
    const card = gEl("div", "pt-song");
    const cover = gEl("div", "pt-cover");
    if (vid) {
        cover.classList.add("img");
        cover.style.backgroundImage = 'url("https://i.ytimg.com/vi/' + vid + '/mqdefault.jpg")';
    } else {
        cover.innerHTML = PT_ICONS.note;
    }
    const tx = gEl("div", "pt-song-tx");
    const len = Number(ex.song_len) || 30;
    tx.append(gEl("strong", "", ex.song_title),
              gEl("span", "", (ex.song_artist || "") + (vid ? (ex.song_artist ? " · " : "") + len + "s clip" : "")));
    card.append(cover, tx);

    if (vid) {
        const b = gEl("button", "pt-play");
        b.type = "button";
        b.setAttribute("aria-label", "Play clip");
        b.innerHTML = PT_ICONS.play;
        b.addEventListener("click", () => openSongSheet({
            vid, start: Number(ex.song_start) || 0, len, title: ex.song_title, artist: ex.song_artist
        }));
        card.appendChild(b);
    } else {
        const url = ptSafeLink(ex.song_url);
        if (url) {
            const a = gEl("a", "pt-play");
            a.href = url;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            a.setAttribute("aria-label", "Open song");
            a.innerHTML = PT_ICONS.play;
            card.appendChild(a);
        }
    }
    return card;
}

// ---------- the Edit profile page, now with the clip picker ----------
async function openEditProfilePage() {
    if (!myProfile || !authUser) return;
    const ex0 = (await ptFetch(myProfile.username)) || {};
    const st = {
        theme: ex0.theme || "pink",
        accent: ex0.accent || "#C77DFF",
        bannerUrl: ex0.banner_url || null,
        bannerPreview: ex0.banner_url || null,
        bannerBlob: null,
        avatarPreview: myProfile.avatar_url || null,
        avatarBlob: null,
        songStart: Number(ex0.song_start) || 0,
        songLen: [15, 30, 50].includes(Number(ex0.song_len)) ? Number(ex0.song_len) : 30
    };

    const page = openSubPage("editPage", "Edit profile");
    const body = page.querySelector(".sp-body");
    const saveBtn = gBtn("Save", "sp-save", save);
    page.querySelector(".sp-gap").replaceWith(saveBtn);

    const hiddenFile = () => {
        const f = document.createElement("input");
        f.type = "file";
        f.accept = "image/*";
        f.hidden = true;
        return f;
    };
    const sec = (label, ...kids) => {
        const s = gEl("div", "pe-section");
        if (label) s.append(gEl("div", "pe-label", label));
        s.append(...kids);
        return s;
    };
    const field = (ph, val, max) => {
        const i = gEl("input");
        i.placeholder = ph;
        i.value = val || "";
        i.maxLength = max;
        return i;
    };

    // banner + photo
    const banner = gEl("div", "pt-banner");
    const bFile = hiddenFile();
    const bRow = gEl("div", "pe-btns");
    bRow.append(
        gBtn("Change banner", "pe-btn", () => bFile.click()),
        gBtn("Remove banner", "pe-btn", () => {
            st.bannerBlob = null; st.bannerUrl = null; st.bannerPreview = null; preview();
        }),
        bFile
    );

    const av = gEl("div", "pe-av");
    const aFile = hiddenFile();
    const avRow = gEl("div", "pe-avrow");
    avRow.append(av, gBtn("Change photo", "pe-btn", () => aFile.click()), aFile);

    // text fields
    const nameIn = field("Name", myProfile.display_name || "", 30);
    const bioIn = gEl("textarea", "pe-ta");
    bioIn.placeholder = "Bio";
    bioIn.maxLength = 150;
    bioIn.value = myProfile.bio || "";

    // theme picker
    const sw = gEl("div", "pe-swatches");
    const swBtns = {};
    Object.keys(PT_THEMES).concat("custom").forEach(k => {
        const t = ptTheme(k, st.accent);
        const b = gEl("button", "pe-sw" + (k === "custom" ? " custom" : ""));
        b.type = "button";
        const dot = gEl("span", "pe-dot");
        if (k !== "custom") dot.style.background = t.dot;
        b.append(dot, gEl("span", "", t.label));
        b.addEventListener("click", () => { st.theme = k; preview(); });
        swBtns[k] = b;
        sw.appendChild(b);
    });
    const color = gEl("input", "pe-color");
    color.type = "color";
    color.value = st.accent;
    color.addEventListener("input", () => { st.accent = color.value; preview(); });

    // favourite song + clip picker
    const songT = field("Song name", ex0.song_title, 60);
    const songA = field("Artist", ex0.song_artist, 60);
    const songL = field("YouTube link (https://...)", ex0.song_url, 300);

    const onInfo = d => {
        if (!songT.value.trim() && d.title) songT.value = String(d.title).slice(0, 60);
        if (!songA.value.trim() && d.author) songA.value = String(d.author).replace(/ - Topic$/, "").slice(0, 60);
    };

    const clipInfo = gEl("div", "pe-clipinfo");
    const lenRow = gEl("div", "pe-chips");
    const lenBtns = {};
    [15, 30, 50].forEach(n => {
        const b = gBtn(n + "s", "pe-chip", () => { st.songLen = n; updClip(); });
        lenBtns[n] = b;
        lenRow.appendChild(b);
    });

    const needVid = () => {
        const vid = ytId(songL.value);
        if (!vid) alert("Paste a YouTube link first.");
        return vid;
    };
    const clipBtns = gEl("div", "pe-btns");
    clipBtns.append(
        gBtn("Pick the part", "pe-btn", () => {
            const vid = needVid();
            if (vid) openSongSheet({ vid, start: st.songStart, pick: true, onInfo, onPick: t => { st.songStart = t; updClip(); } });
        }),
        gBtn("Preview clip", "pe-btn", () => {
            const vid = needVid();
            if (vid) openSongSheet({ vid, start: st.songStart, len: st.songLen, title: songT.value, artist: songA.value, onInfo });
        }),
        gBtn("-5s", "pe-btn", () => { st.songStart = Math.max(0, st.songStart - 5); updClip(); }),
        gBtn("+5s", "pe-btn", () => { st.songStart += 5; updClip(); })
    );

    function updClip() {
        const vid = ytId(songL.value);
        clipInfo.textContent = vid
            ? "Clip: " + ytTime(st.songStart) + " to " + ytTime(st.songStart + st.songLen)
            : "Paste a YouTube link to play a clip inside the app.";
        Object.keys(lenBtns).forEach(n => lenBtns[n].classList.toggle("on", Number(n) === st.songLen));
    }
    songL.addEventListener("input", updClip);

    body.append(
        sec("", banner, bRow),
        sec("Photo", avRow),
        sec("Name", nameIn),
        sec("Bio", bioIn),
        sec("Profile theme", sw, color),
        sec("Favourite song", songT, songA, songL, clipInfo, lenRow, clipBtns),
        gEl("p", "pt-note", "Your banner, theme and song are only visible to your friends.")
    );

    function preview() {
        ptApply(page, { theme: st.theme, accent: st.accent, banner_url: st.bannerPreview });
        paintAvatar(av, st.avatarPreview, nameIn.value || myProfile.username);
        Object.keys(swBtns).forEach(k => swBtns[k].classList.toggle("on", k === st.theme));
        color.style.display = st.theme === "custom" ? "" : "none";
    }
    nameIn.addEventListener("input", preview);

    aFile.addEventListener("change", async () => {
        const f = aFile.files[0];
        aFile.value = "";
        if (!f) return;
        const blob = await ptCrop(f, 256, 256, 0.85);
        if (!blob) { gToast("Could not read that image"); return; }
        st.avatarBlob = blob;
        st.avatarPreview = URL.createObjectURL(blob);
        preview();
    });
    bFile.addEventListener("change", async () => {
        const f = bFile.files[0];
        bFile.value = "";
        if (!f) return;
        const blob = await ptCrop(f, 1200, 400, 0.85);
        if (!blob) { gToast("Could not read that image"); return; }
        st.bannerBlob = blob;
        st.bannerPreview = URL.createObjectURL(blob);
        preview();
    });

    preview();
    updClip();

    async function upload(path, blob) {
        const { error } = await supabaseClient.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg" });
        if (error) throw error;
        return supabaseClient.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    }

    async function save() {
        const title = songT.value.trim();
        const link = songL.value.trim();
        if (link && !ptSafeLink(link)) { alert("The song link must start with https://"); return; }

        saveBtn.disabled = true;
        saveBtn.textContent = "Saving...";
        try {
            let avatarUrl = myProfile.avatar_url || null;
            if (st.avatarBlob) avatarUrl = await upload(authUser.id + "/" + crypto.randomUUID() + ".jpg", st.avatarBlob);

            let bannerUrl = st.bannerUrl;
            if (st.bannerBlob) bannerUrl = await upload(authUser.id + "/banner-" + crypto.randomUUID() + ".jpg", st.bannerBlob);

            const r1 = await supabaseClient.from("profiles").update({
                display_name: nameIn.value.trim() || myProfile.username,
                bio: bioIn.value.trim().slice(0, 150),
                avatar_url: avatarUrl
            }).eq("id", authUser.id);
            if (r1.error) throw r1.error;

            const vid = ytId(link);
            const r2 = await supabaseClient.from("profile_extras").upsert({
                user_id: authUser.id,
                banner_url: bannerUrl,
                theme: st.theme,
                accent: st.theme === "custom" ? st.accent : null,
                song_title: title || null,
                song_artist: title ? (songA.value.trim() || null) : null,
                song_url: title ? (link || null) : null,
                song_vid: title && vid ? vid : null,
                song_start: Math.max(0, Math.floor(st.songStart)),
                song_len: st.songLen,
                updated_at: new Date().toISOString()
            }, { onConflict: "user_id" });
            if (r2.error) throw r2.error;

            await loadProfile();
            renderProfile();
            page.remove();
            gToast("Profile saved");
        } catch (e) {
            console.error(e);
            alert("Could not save: " + (e.message || e));
            saveBtn.disabled = false;
            saveBtn.textContent = "Save";
        }
    }
}
// ================================
// PROFILE v3: notes, stories, highlights, posts (friends only)
// Paste below the IN-APP SONG CLIPS block
// ================================

// Note colours: light and dark shades [background, text]
const PX_NOTE = [
    { bg: "#FFFFFF", fg: "#3A2E3A" }, { bg: "#FFE0EC", fg: "#7A2E52" }, { bg: "#D6457F", fg: "#FFFFFF" },
    { bg: "#DCEEFF", fg: "#1F4B7A" }, { bg: "#2F6FDB", fg: "#FFFFFF" }, { bg: "#EADFFF", fg: "#4B2E8A" },
    { bg: "#7C4DDB", fg: "#FFFFFF" }, { bg: "#DDF5E3", fg: "#1E5B34" }, { bg: "#2E8B57", fg: "#FFFFFF" },
    { bg: "#FFF3C4", fg: "#6B5200" }, { bg: "#FFE3D1", fg: "#7A3E1A" }, { bg: "#26262C", fg: "#FFFFFF" }
];
const pxKey = i => "c" + (i + 1);
const pxIdx = k => {
    const n = parseInt(String(k || "c1").slice(1), 10);
    return n >= 1 && n <= 12 ? n - 1 : 0;
};

// ---------- helpers ----------
function pxPick(multiple) {
    return new Promise(resolve => {
        const f = document.createElement("input");
        f.type = "file";
        f.accept = "image/*";
        f.multiple = !!multiple;
        f.style.display = "none";
        f.addEventListener("change", () => {
            const files = Array.from(f.files || []);
            f.remove();
            resolve(files);
        });
        document.body.appendChild(f);
        f.click();
    });
}

function pxResize(file, max, quality) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            const s = Math.min(1, max / Math.max(img.width, img.height));
            const c = document.createElement("canvas");
            c.width = Math.round(img.width * s);
            c.height = Math.round(img.height * s);
            c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
            c.toBlob(b => resolve(b), "image/jpeg", quality);
            URL.revokeObjectURL(img.src);
        };
        img.onerror = () => resolve(null);
        img.src = URL.createObjectURL(file);
    });
}

async function pxUpload(blob, kind) {
    const path = authUser.id + "/" + kind + "-" + crypto.randomUUID() + ".jpg";
    const { error } = await supabaseClient.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg" });
    if (error) throw error;
    return supabaseClient.storage.from("avatars").getPublicUrl(path).data.publicUrl;
}

async function pxDel(table, id) {
    const { error } = await supabaseClient.from(table).delete().eq("id", id);
    if (error) throw error;
}

function pxModal() {
    const m = gEl("div", "modal");
    const card = gEl("div", "modal-card px-card");
    m.appendChild(card);
    m.addEventListener("click", e => { if (e.target === m) m.remove(); });
    document.body.appendChild(m);
    return { m, card, close: () => m.remove() };
}

function pxAsk(title, placeholder, max) {
    return new Promise(resolve => {
        const { m, card } = pxModal();
        const inp = gEl("input");
        inp.placeholder = placeholder;
        inp.maxLength = max;
        const done = v => { m.remove(); resolve(v); };
        m.addEventListener("click", e => { if (e.target === m) resolve(null); });
        card.append(
            gEl("h3", "", title), inp,
            gBtn("OK", "primary-btn", () => done(inp.value.trim() || null)),
            gBtn("Cancel", "secondary-btn", () => done(null))
        );
        inp.focus();
    });
}

// ---------- full-screen viewer (stories, highlights, posts) ----------
// o: { items, start, auto, name, avatarBg, initial, canDelete, onDelete(item), actions:[{label, fn(item, ctrl)}], onClose }
function pxViewer(o) {
    const items = (o.items || []).slice();
    if (!items.length) return;
    let i = Math.min(Math.max(o.start || 0, 0), items.length - 1);
    let timer = null;

    const root = gEl("div", "px-viewer" + (o.auto ? " auto" : ""));
    const bars = gEl("div", "px-bars");
    const head = gEl("div", "px-vhead");
    const av = gEl("div", "px-vav");
    if (o.avatarBg) av.style.backgroundImage = o.avatarBg; else av.textContent = o.initial || "";
    const who = gEl("div", "px-who");
    const when = gEl("span", "px-when");
    who.append(gEl("strong", "", o.name || ""), when);
    head.append(av, who, gBtn("×", "px-x", closeV));
    const img = gEl("img", "px-vimg");
    const cap = gEl("div", "px-cap");
    const acts = gEl("div", "px-acts");
    const zl = gEl("div", "px-zone l");
    const zr = gEl("div", "px-zone r");
    zl.addEventListener("click", () => show(Math.max(0, i - 1)));
    zr.addEventListener("click", next);
    root.append(bars, head, img, cap, acts, zl, zr);
    document.body.appendChild(root);

    function drawBars() {
        bars.innerHTML = "";
        items.forEach(() => bars.appendChild(gEl("i")));
    }
    function next() { if (i + 1 < items.length) show(i + 1); else closeV(); }
    function closeV() {
        clearTimeout(timer);
        root.remove();
        if (o.onClose) o.onClose();
    }
    function renderActs() {
        acts.innerHTML = "";
        if (o.canDelete) {
            acts.appendChild(gBtn("Delete", "px-act danger", async () => {
                if (!confirm("Delete this?")) return;
                clearTimeout(timer);
                try { await o.onDelete(items[i]); }
                catch (e) { console.error(e); gToast("Could not delete"); show(i); return; }
                items.splice(i, 1);
                if (!items.length) { closeV(); return; }
                drawBars();
                show(Math.min(i, items.length - 1));
            }));
        }
        (o.actions || []).forEach(a => acts.appendChild(gBtn(a.label, "px-act", () => {
            clearTimeout(timer);
            a.fn(items[i], { close: closeV, show: () => show(i) });
        })));
    }
    function show(n) {
        i = n;
        clearTimeout(timer);
        Array.from(bars.children).forEach(b => { b.className = ""; });
        void bars.offsetWidth;   // restart the progress animation
        Array.from(bars.children).forEach((b, k) => { b.className = k < i ? "done" : k === i ? "now" : ""; });
        const it = items[i];
        img.src = ptSafeUrl(it.media_url);
        cap.textContent = it.caption || "";
        cap.style.display = it.caption ? "" : "none";
        when.textContent = timeAgo(it.created_at);
        renderActs();
        if (o.auto) timer = setTimeout(next, 5000);
    }

    drawBars();
    show(i);
}

// ---------- compose a story or a post ----------
async function pxCompose(kind, done) {
    const files = await pxPick(false);
    const f = files[0];
    if (!f) return;
    const blob = await pxResize(f, kind === "post" ? 1440 : 1080, 0.85);
    if (!blob) { gToast("Could not read that image"); return; }
    const url = URL.createObjectURL(blob);
    const { card, close } = pxModal();
    const img = gEl("img", "px-prev");
    img.src = url;
    const cap = gEl("input");
    cap.placeholder = "Add a caption (optional)";
    cap.maxLength = kind === "post" ? 200 : 120;
    const go = gBtn("Share", "primary-btn", async () => {
        go.disabled = true;
        go.textContent = "Sharing...";
        try {
            const media = await pxUpload(blob, kind);
            const { error } = await supabaseClient
                .from(kind === "post" ? "profile_posts" : "profile_stories")
                .insert({ user_id: authUser.id, media_url: media, caption: cap.value.trim() || null });
            if (error) throw error;
            close();
            URL.revokeObjectURL(url);
            gToast(kind === "post" ? "Post shared" : "Story shared for 24 hours");
            if (done) done();
        } catch (e) {
            console.error(e);
            alert("Could not share: " + (e.message || e));
            go.disabled = false;
            go.textContent = "Share";
        }
    });
    card.append(
        gEl("h3", "", kind === "post" ? "New post" : "New story"), img, cap,
        gEl("p", "pt-note", "Only your friends can see this" + (kind === "story" ? " for 24 hours." : ".")),
        go, gBtn("Cancel", "secondary-btn", close)
    );
}

// ---------- note editor ----------
function pxNoteEditor(cur, done) {
    const { card, close } = pxModal();
    let ci = cur ? pxIdx(cur.color) : 0;
    const prev = gEl("div", "px-nprev");
    const ta = gEl("textarea", "pe-ta");
    ta.maxLength = 60;
    ta.placeholder = "Share a thought...";
    ta.value = cur ? cur.body : "";
    const cnt = gEl("div", "px-count");
    const sw = gEl("div", "px-nsw");

    function paint() {
        const c = PX_NOTE[ci];
        prev.style.background = c.bg;
        prev.style.color = c.fg;
        prev.textContent = ta.value.trim() || "Your note";
        cnt.textContent = ta.value.length + "/60";
        Array.from(sw.children).forEach((b, k) => b.classList.toggle("on", k === ci));
    }
    PX_NOTE.forEach((c, k) => {
        const b = gEl("button", "px-ndot");
        b.type = "button";
        b.style.background = c.bg;
        b.addEventListener("click", () => { ci = k; paint(); });
        sw.appendChild(b);
    });
    ta.addEventListener("input", paint);

    const share = gBtn("Share", "primary-btn", async () => {
        const body = ta.value.trim();
        if (!body) { gToast("Write something first"); return; }
        share.disabled = true;
        const { error } = await supabaseClient.from("profile_notes").upsert(
            { user_id: authUser.id, body, color: pxKey(ci), created_at: new Date().toISOString() },
            { onConflict: "user_id" }
        );
        if (error) {
            console.error(error);
            alert("Could not share: " + error.message);
            share.disabled = false;
            return;
        }
        close();
        gToast("Note shared with your friends for 24 hours");
        if (done) done();
    });

    card.append(gEl("h3", "", "Your note"), prev, ta, cnt, sw, share);
    if (cur) {
        card.append(gBtn("Delete note", "secondary-btn", async () => {
            await supabaseClient.from("profile_notes").delete().eq("user_id", authUser.id);
            close();
            if (done) done();
        }));
    }
    card.append(gBtn("Cancel", "secondary-btn", close), gEl("p", "pt-note", "Only your friends can see it, for 24 hours.")); 
    paint();
}

// ---------- highlights ----------
async function pxCreateHighlight(title, arr) {
    const { data, error } = await supabaseClient.from("profile_highlights")
        .insert({ user_id: authUser.id, title, cover_url: arr[0].url })
        .select("id").single();
    if (error) throw error;
    const rows = arr.map(x => ({ highlight_id: data.id, user_id: authUser.id, media_url: x.url, caption: x.caption || null }));
    const r = await supabaseClient.from("profile_highlight_items").insert(rows);
    if (r.error) throw r.error;
}

async function pxAddItem(hid, url, caption) {
    const { error } = await supabaseClient.from("profile_highlight_items")
        .insert({ highlight_id: hid, user_id: authUser.id, media_url: url, caption: caption || null });
    if (error) throw error;
}

async function pxNewHighlight(done) {
    const title = await pxAsk("New highlight", "Name (e.g. Friends)", 20);
    if (!title) return;
    const files = (await pxPick(true)).slice(0, 10);
    if (!files.length) return;
    try {
        const arr = [];
        for (let k = 0; k < files.length; k++) {
            gToast("Uploading " + (k + 1) + "/" + files.length);
            const blob = await pxResize(files[k], 1080, 0.85);
            if (blob) arr.push({ url: await pxUpload(blob, "hl"), caption: null });
        }
        if (!arr.length) { gToast("Could not read those images"); return; }
        await pxCreateHighlight(title, arr);
        gToast("Highlight created");
        if (done) done();
    } catch (e) {
        console.error(e);
        alert("Could not create the highlight: " + (e.message || e));
    }
}

async function pxToHighlight(it) {
    const { data } = await supabaseClient.rpc("px_highlights", { p_username: myProfile.username });
    const items = (data || []).map(h => [h.title, async () => {
        try { await pxAddItem(h.id, it.media_url, it.caption); gToast("Added to " + h.title); }
        catch (e) { console.error(e); gToast("Could not add it"); }
    }]);
    items.push(["New highlight", async () => {
        const t = await pxAsk("New highlight", "Name (e.g. Friends)", 20);
        if (!t) return;
        try { await pxCreateHighlight(t, [{ url: it.media_url, caption: it.caption }]); gToast("Highlight created"); }
        catch (e) { console.error(e); gToast("Could not create it"); }
    }]);
    items.push(["Cancel", () => {}]);
    showSheet(items, "Add to highlight");
}

function pxHlItem(symbol, label, cover, fn) {
    const b = gEl("button", "px-hl-item");
    b.type = "button";
    const c = gEl("div", "px-hl-c");
    const u = ptSafeUrl(cover);
    if (u) c.style.backgroundImage = 'url("' + u + '")'; else c.textContent = symbol;
    b.append(c, gEl("span", "", label));
    b.addEventListener("click", fn);
    return b;
}

async function pxOpenHighlight(hl, ctx, owner) {
    const { data, error } = await supabaseClient.rpc("px_highlight_items", { p_highlight: hl.id });
    if (error || !data || !data.length) { gToast("Nothing in this highlight yet"); return; }
    pxViewer({
        items: data, auto: true,
        name: owner.name, avatarBg: owner.avatarBg, initial: owner.initial,
        canDelete: ctx.self,
        onDelete: it => pxDel("profile_highlight_items", it.id),
        actions: ctx.self ? [{
            label: "Delete highlight",
            fn: async (it, c) => {
                if (!confirm("Delete the whole highlight?")) return;
                try { await pxDel("profile_highlights", hl.id); c.close(); }
                catch (e) { console.error(e); gToast("Could not delete it"); }
            }
        }] : [],
        onClose: () => { if (ctx.self) pxBuild(ctx); }
    });
}

function pxViewStories(x) {
    const { d, ctx, owner } = x;
    pxViewer({
        items: d.stories, auto: true,
        name: owner.name, avatarBg: owner.avatarBg, initial: owner.initial,
        canDelete: ctx.self,
        onDelete: it => pxDel("profile_stories", it.id),
        actions: ctx.self ? [{ label: "Add to highlight", fn: it => pxToHighlight(it) }] : [],
        onClose: () => { if (ctx.self) pxBuild(ctx); }
    });
}

// ---------- avatar wrapper: note bubble, story ring, + badge ----------
function pxWrapAvatar(av) {
    let w = av.parentElement;
    if (!w || !w.classList.contains("av-wrap")) {
        w = gEl("div", "av-wrap");
        av.replaceWith(w);
        w.appendChild(av);
    }
    return w;
}

function pxAvatarClick(e) {
    const w = e.currentTarget;
    const x = w._px;
    if (!x) return;
    e.stopPropagation();
    e.preventDefault();
    const { d, ctx } = x;
    if (e.target.closest(".note-bubble")) {
        if (ctx.self) pxNoteEditor(d.note, () => pxBuild(ctx));
        return;
    }
    if (e.target.closest(".av-plus")) { pxCompose("story", () => pxBuild(ctx)); return; }
    if (d.can && d.stories.length) { pxViewStories(x); return; }
    if (ctx.self) pxCompose("story", () => pxBuild(ctx));
}

// ---------- build everything on a profile page ----------
async function pxBuild(ctx) {
    const { page, username, self } = ctx;
    if (!page || !ctx.avatar || !ctx.head || !ctx.title) return;
    page._pxTok = (page._pxTok || 0) + 1;
    const tok = page._pxTok;

    const q = name => supabaseClient.rpc(name, { p_username: username });
    const [n, s, h, p, c] = await Promise.all([
        q("px_note"), q("px_stories"), q("px_highlights"), q("px_posts"), q("px_can_see")
    ]);
    if (page._pxTok !== tok || !page.isConnected) return;
    const bad = [n, s, h, p, c].find(r => r.error);
    if (bad) { console.error("profile v3", bad.error); return; }

    const d = {
        note: (n.data && n.data[0]) || null,
        stories: s.data || [],
        highlights: h.data || [],
        posts: p.data || [],
        can: !!c.data
    };
    const nmEl = page.querySelector(".pf-name, .upg-nm");
    const owner = {
        name: (nmEl && nmEl.textContent) || username,
        avatarBg: ctx.avatar.style.backgroundImage || "",
        initial: (ctx.avatar.textContent || "").trim().charAt(0)
    };

    page.querySelectorAll(".px-hl, .px-tabs, .px-posts").forEach(el => el.remove());

    // avatar: story ring, note bubble, + badge
    const w = pxWrapAvatar(ctx.avatar);
    w._px = { d, ctx, owner };
    if (!w._pxBound) { w._pxBound = true; w.addEventListener("click", pxAvatarClick, true); }
    w.classList.toggle("has-story", d.can && d.stories.length > 0);
    w.querySelectorAll(".note-bubble, .av-plus").forEach(el => el.remove());

    if (d.note) {
        const col = PX_NOTE[pxIdx(d.note.color)];
        const b = gEl("div", "note-bubble");
        b.style.background = col.bg;
        b.style.color = col.fg;
        b.appendChild(gEl("span", "nb-t", d.note.body));
        w.appendChild(b);
    } else if (self) {
        const b = gEl("div", "note-bubble ghost");
        b.appendChild(gEl("span", "nb-t", "Note..."));
        w.appendChild(b);
    }
    if (self) {
        const plus = gEl("button", "av-plus", "+");
        plus.type = "button";
        w.appendChild(plus);
    }
    ctx.head.classList.toggle("px-has-note", !!(d.note || self));

    // highlights row
    if (self || d.highlights.length) {
        const row = gEl("div", "px-hl");
        if (self) row.appendChild(pxHlItem("+", "New", null, () => pxNewHighlight(() => pxBuild(ctx))));
        d.highlights.forEach(hl => row.appendChild(
            pxHlItem("", hl.title, hl.cover_url, () => pxOpenHighlight(hl, ctx, owner))));
        ctx.title.before(row);
    }

// Posts / Rooms tabs (friends and the owner only)
    if (!d.can) {
        ctx.title.classList.remove("px-hide");
        if (ctx.list) ctx.list.classList.remove("px-hide");
        return;
    }
    ctx.title.classList.add("px-hide");

    const tabs = gEl("div", "px-tabs");
    const posts = gEl("div", "px-posts");
    const grid = gEl("div", "px-grid");
    if (self) {
        const add = gEl("button", "px-cell add", "+");
        add.type = "button";
        add.addEventListener("click", () => pxCompose("post", () => pxBuild(ctx)));
        grid.appendChild(add);
    }
    d.posts.forEach((po, k) => {
        const cell = gEl("button", "px-cell");
        cell.type = "button";
        const u = ptSafeUrl(po.media_url);
        if (u) cell.style.backgroundImage = 'url("' + u + '")';
        cell.addEventListener("click", () => pxViewer({
            items: d.posts, start: k, auto: false,
            name: owner.name, avatarBg: owner.avatarBg, initial: owner.initial,
            canDelete: self,
            onDelete: it => pxDel("profile_posts", it.id),
            onClose: () => { if (self) pxBuild(ctx); }
        }));
        grid.appendChild(cell);
    });
    if (!d.posts.length && !self) grid.appendChild(gEl("p", "empty", "No posts yet."));
    posts.appendChild(grid);

    const bP = gBtn("Posts", "px-tab", () => setTab("posts"));
    const bR = gBtn("Rooms", "px-tab", () => setTab("rooms"));
    tabs.append(bP, bR);
    const setTab = t => {
        bP.classList.toggle("on", t === "posts");
        bR.classList.toggle("on", t === "rooms");
        posts.classList.toggle("px-hide", t !== "posts");
        if (ctx.list) ctx.list.classList.toggle("px-hide", t !== "rooms");
    };
    ctx.title.before(tabs, posts);
    setTab(self || d.posts.length ? "posts" : "rooms");
}

async function pxRenderMe() {
    const page = $("profilePage");
    const wrap = page && page.querySelector(".pf-wrap");
    if (!wrap || !myProfile) return;
    const title = wrap.querySelector(".myrooms-title");
    if (!title) return;
    await pxBuild({
        page, username: myProfile.username, self: true,
        avatar: $("profAvatar"), head: wrap.querySelector(".pf-head"),
        title, list: $("myRoomsList")
    });
}

async function pxRenderUser(username) {
    if (!username || isAI(username)) return;
    const page = $("userProfilePage");
    if (!page) return;
    const title = page.querySelector(".myrooms-title");
    if (!title) return;
    await pxBuild({
        page, username, self: !!myProfile && myProfile.username === username,
        avatar: page.querySelector(".upg-pic"), head: page.querySelector(".upg-head"),
        title, list: title.nextElementSibling
    });
}

// Hook into the existing profile renderers
const _ptRenderMe3 = ptRenderMe;
ptRenderMe = async function () {
    await _ptRenderMe3();
    try { await pxRenderMe(); } catch (e) { console.error(e); }
};
const _ptEnhance3 = ptEnhanceUserPage;
ptEnhanceUserPage = async function (u) {
    await _ptEnhance3(u);
    try { await pxRenderUser(u); } catch (e) { console.error(e); }
};
// ================================
// CHAT STYLE PACK
// 1) reaction fixes  2) voice-message player  3) 8 bubble styles  4) 8 chat themes
// Paste at the very end of auth.js. No other file needs to change.
// ================================

// ---------- symbols used by the bubble decorations and chat backgrounds ----------
const CT_SYM = {
    heart: '<path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z"/>',
    star: '<path d="M12 2l2.9 6.9L22 10l-5.5 4.8L18 22l-6-3.6L6 22l1.5-7.2L2 10l7.1-1.1z"/>',
    sparkle: '<path d="M12 1c.9 6 5 10.1 11 11-6 .9-10.1 5-11 11-.9-6-5-10.1-11-11 6-.9 10.1-5 11-11z"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 7 7 0 0 0 20 14.5z"/>',
    butterfly: '<path d="M12 12C9 3 2 5 3 11s6 8 9 1z"/><path d="M12 12c3-9 10-7 9-1s-6 8-9 1z"/>',
    blossom: '<ellipse cx="12" cy="5.8" rx="3.6" ry="5.6"/><ellipse cx="12" cy="5.8" rx="3.6" ry="5.6" transform="rotate(72 12 12)"/><ellipse cx="12" cy="5.8" rx="3.6" ry="5.6" transform="rotate(144 12 12)"/><ellipse cx="12" cy="5.8" rx="3.6" ry="5.6" transform="rotate(216 12 12)"/><ellipse cx="12" cy="5.8" rx="3.6" ry="5.6" transform="rotate(288 12 12)"/><circle cx="12" cy="12" r="2.1" fill="#fff" fill-opacity=".7"/>',
    bow: '<path d="M12 12C9 5 2.5 5.5 3 11s6.5 7 9 1z"/><path d="M12 12c3-7 9.5-6.5 9-1s-6.5 7-9 1z"/><path d="M10.6 13.2L7.8 21.5l3.1-1.9zM13.4 13.2l2.8 8.3-3.1-1.9z"/><circle cx="12" cy="12" r="2.3"/>',
    bubble: '<circle cx="12" cy="12" r="10.5" stroke="#fff" stroke-opacity=".8" stroke-width="1.2"/><ellipse cx="8.2" cy="8" rx="3.2" ry="1.8" transform="rotate(-38 8.2 8)" fill="#fff" fill-opacity=".85"/>',
    cloud: '<circle cx="8" cy="14" r="4.5"/><circle cx="13.5" cy="11.5" r="5.5"/><circle cx="17.5" cy="15" r="3.8"/><rect x="8" y="14" width="10" height="4.5" rx="2"/>',
    strawberry: '<path d="M12 21.5C6.2 18.5 4.2 13.2 6 9.4c1.4-2.9 4.2-3.6 6-2.4 1.8-1.2 4.6-.5 6 2.4 1.8 3.8-.2 9.1-6 12.1z"/><path d="M7.5 7.3c1.6-2.2 3.1-2.8 4.5-1.2 1.4-1.6 2.9-1 4.5 1.2-1.8.5-3 .5-4.5 1.3-1.5-.8-2.7-.8-4.5-1.3z" fill="#5CB874"/><circle cx="9.5" cy="12" r=".7" fill="#fff" fill-opacity=".85"/><circle cx="14.5" cy="12.5" r=".7" fill="#fff" fill-opacity=".85"/><circle cx="12" cy="16" r=".7" fill="#fff" fill-opacity=".85"/>',
    bear: '<circle cx="6.6" cy="7.2" r="3.1"/><circle cx="17.4" cy="7.2" r="3.1"/><circle cx="12" cy="13.2" r="7.6"/><ellipse cx="12" cy="15.6" rx="3.3" ry="2.6" fill="#fff" fill-opacity=".55"/><circle cx="9.2" cy="12" r=".95" fill="#3a2418"/><circle cx="14.8" cy="12" r=".95" fill="#3a2418"/><ellipse cx="12" cy="14.5" rx="1.1" ry=".8" fill="#3a2418"/>'
};

// ---------- 1. Reactions: targeted fixes ----------

// Fix: when an emoji image failed to load, the old code swapped it for plain text and the emoji
// observer turned that text into an image again, forever. Plain text is now marked and skipped.
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
            const s = document.createElement("span");
            s.className = "emoji-plain";
            s.textContent = str;
            img.replaceWith(s);
        }
    };
    return img;
}

function convertEmoji(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            const p = node.parentNode;
            if (!p || /^(SCRIPT|STYLE|TEXTAREA|INPUT)$/.test(p.nodeName)) return NodeFilter.FILTER_REJECT;
            if (p.classList && p.classList.contains("emoji-plain")) return NodeFilter.FILTER_REJECT;
            EMOJI_RE.lastIndex = 0;
            return EMOJI_RE.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
        const text = node.nodeValue;
        const frag = document.createDocumentFragment();
        let last = 0;
        for (const m of text.matchAll(EMOJI_RE)) {
            if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
            frag.appendChild(makeEmojiImg(m[0]));
            last = m.index + m[0].length;
        }
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        node.replaceWith(frag);
    });
}

// Remember where the finger is, so the reaction menu never opens under it
let lastPress = { x: 0, y: 0 };
document.addEventListener("pointerdown", e => { lastPress = { x: e.clientX, y: e.clientY }; }, true);
document.addEventListener("touchstart", e => {
    const t = e.touches && e.touches[0];
    if (t) lastPress = { x: t.clientX, y: t.clientY };
}, { capture: true, passive: true });

async function sendReaction(messageId, emoji) {
    if (!messageId) return;
    const { error } = await supabaseClient.rpc("react_message", {
        p_id: String(messageId), p_user: currentUser, p_emoji: emoji
    });
    if (error) {
        console.error("react_message:", error);
        gToast("Reaction failed: " + (error.message || "unknown error"));
        return;
    }
    // Show the result right away instead of waiting for the realtime update
    const { data } = await supabaseClient.from("messages").select("reactions").eq("id", messageId).maybeSingle();
    const el = document.querySelector('[data-message-id="' + messageId + '"] .message-bubble');
    if (data && el) renderReactions(el, data.reactions);
}

function closeMessageMenu() {
    const old = document.querySelector(".message-menu");
    if (old) old.remove();
    if (window.__menuOff) { window.__menuOff(); window.__menuOff = null; }
}

function openMessageMenu(message, wrapper) {
    closeMessageMenu();
    const opened = Date.now();
    const menu = document.createElement("div");
    menu.className = "message-menu";

    REACTIONS.forEach(emoji => {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.emoji = emoji;
        b.appendChild(makeEmojiImg(emoji));
        b.addEventListener("click", e => {
            e.stopPropagation();
            if (Date.now() - opened < 350) return;   // ignore the release of the long press
            const removing = b.classList.contains("on");
            closeMessageMenu();
            sendReaction(message.id, emoji);
            if (removing) gToast("Reaction removed");
        });
        menu.appendChild(b);
    });

    if (message.username === currentUser) {
        const del = document.createElement("button");
        del.type = "button";
        del.appendChild(makeEmojiImg("🗑️"));
        del.addEventListener("click", async e => {
            e.stopPropagation();
            if (Date.now() - opened < 350) return;
            closeMessageMenu();
            if (!confirm("Delete this message?")) return;
            const { data, error } = await supabaseClient.from("messages").delete().eq("id", message.id).select();
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

    // Keep the menu away from the finger and inside the screen
    const h = menu.offsetHeight || 52;
    let top = lastPress.y - h - 24;
    if (top < 76) top = lastPress.y + 36;
    top = Math.min(Math.max(top, 76), window.innerHeight - h - 16);
    menu.style.top = top + "px";

    // Highlight the reaction I already gave (tapping it again removes it)
    supabaseClient.from("messages").select("reactions").eq("id", message.id).maybeSingle().then(({ data }) => {
        const mine = data && data.reactions && data.reactions[currentUser];
        if (!mine) return;
        menu.querySelectorAll("button[data-emoji]").forEach(b => b.classList.toggle("on", b.dataset.emoji === mine));
    });

    const outside = e => { if (!menu.contains(e.target)) closeMessageMenu(); };
    const t = setTimeout(() => document.addEventListener("pointerdown", outside, true), 300);
    window.__menuOff = () => { clearTimeout(t); document.removeEventListener("pointerdown", outside, true); };
}

// ---------- 2. Voice-message player (waveform, play/pause, seek) ----------
const VP_PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
const VP_PAUSE = '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
let vpNow = null;

function vpFmt(s) {
    s = Math.max(0, Math.round(s || 0));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

function vpEnhance(audio) {
    if (!audio || audio.dataset.vp) return;
    audio.dataset.vp = "1";
    audio.controls = false;
    audio.style.display = "none";

    const box = document.createElement("div");
    box.className = "vp";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "vp-btn";
    btn.setAttribute("aria-label", "Play voice message");
    btn.innerHTML = VP_PLAY;
    const wave = document.createElement("div");
    wave.className = "vp-wave";
    const bars = [];
    let seed = 7;
    String(audio.src).split("").forEach(c => { seed = (seed * 31 + c.charCodeAt(0)) >>> 0; });
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 26; i++) {
        const b = document.createElement("i");
        b.style.height = (6 + Math.round(rnd() * 20)) + "px";
        wave.appendChild(b);
        bars.push(b);
    }
    const time = document.createElement("span");
    time.className = "vp-time";
    time.textContent = "0:00";
    box.append(btn, wave, time);
    audio.after(box);
    // Taps on the player must not count as taps on the message (double-tap reaction)
    box.addEventListener("click", e => e.stopPropagation());

    let dur = 0;
    const known = () => isFinite(audio.duration) && audio.duration > 0;
    const paint = () => {
        const cur = audio.currentTime || 0;
        const ratio = dur ? Math.min(1, cur / dur) : 0;
        const upto = Math.floor(ratio * bars.length);
        bars.forEach((b, i) => b.classList.toggle("on", i < upto));
        time.textContent = vpFmt(audio.paused && cur === 0 ? dur : (dur ? dur - cur : cur));
    };
    const setDur = () => { if (known()) { dur = audio.duration; paint(); } };

    audio.addEventListener("loadedmetadata", () => {
        if (!known()) {
            // Recorded files often have no duration: seek far ahead so the browser works it out
            const fix = () => {
                audio.removeEventListener("timeupdate", fix);
                audio.currentTime = 0;
                setDur();
            };
            audio.addEventListener("timeupdate", fix);
            try { audio.currentTime = 1e101; } catch (e) {}
        } else setDur();
    });
    audio.addEventListener("durationchange", setDur);
    audio.addEventListener("timeupdate", paint);
    audio.addEventListener("play", () => { btn.innerHTML = VP_PAUSE; });
    audio.addEventListener("pause", () => { btn.innerHTML = VP_PLAY; });
    audio.addEventListener("ended", () => { audio.currentTime = 0; btn.innerHTML = VP_PLAY; paint(); });

    btn.addEventListener("click", () => {
        if (audio.paused) {
            if (vpNow && vpNow !== audio) vpNow.pause();
            vpNow = audio;
            audio.play().catch(e => { console.error(e); gToast("Could not play this voice message"); });
        } else audio.pause();
    });
    wave.addEventListener("click", () => {});
    wave.addEventListener("click", e => {
        if (!dur) return;
        const r = wave.getBoundingClientRect();
        audio.currentTime = Math.max(0, Math.min(dur, ((e.clientX - r.left) / r.width) * dur));
        paint();
    });
    paint();
}

const _displayMessage4 = displayMessage;
displayMessage = function (m) {
    _displayMessage4(m);
    try {
        if (m && m.audio_url && m.id) {
            const a = document.querySelector('[data-message-id="' + m.id + '"] audio');
            if (a) vpEnhance(a);
        }
    } catch (e) { console.error(e); }
};

// ---------- 3. Bubble styles ----------
const bsSvg = (sym, color) => 'url("data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="' + color + '">' + CT_SYM[sym] + '</g></svg>') + '")';
const bsL = (sym, color, pos, size) => bsSvg(sym, color) + " " + pos + " / " + size + "px " + size + "px no-repeat";

const BS = {
    classic: { label: "Classic" },
    soft: {
        label: "Soft Cute",
        mine: { bg: "#FFD6E7", fg: "#7A2E52", meta: "#B0577D", seen: "#2F9BE0", border: "1.5px solid #FFB5D2",
            radius: "22px 22px 6px 22px", shadow: "0 3px 0 #F7B1CC",
            vpBtn: "#F26FA3", vpFg: "#fff", vpBar: "#F7B0CC", vpOn: "#E04F8A",
            deco: bsL("heart", "#FF6FA5", "right 2px top 2px", 20) },
        theirs: { bg: "#FFF1F7", fg: "#7A2E52", meta: "#B0577D", seen: "#2F9BE0", border: "1.5px solid #FFD3E4",
            radius: "22px 22px 22px 6px", shadow: "0 3px 0 #F9D8E6",
            vpBtn: "#F26FA3", vpFg: "#fff", vpBar: "#F9CADB", vpOn: "#E04F8A",
            deco: bsL("heart", "#FFA3C6", "left 2px top 2px", 16) }
    },
    gradient: {
        label: "Gradient",
        mine: { bg: "linear-gradient(135deg,#8A63FF,#4FA3FF)", fg: "#fff", meta: "rgba(255,255,255,.8)", seen: "#C9F3FF", border: "0",
            radius: "20px 20px 6px 20px", shadow: "0 4px 14px rgba(110,100,255,.5)",
            vpBtn: "#fff", vpFg: "#6A5CFF", vpBar: "rgba(255,255,255,.45)", vpOn: "#fff",
            deco: bsL("sparkle", "#FFFFFF", "right 3px top 3px", 16) },
        theirs: { bg: "linear-gradient(135deg,#A99BFF,#86BCFF)", fg: "#fff", meta: "rgba(255,255,255,.85)", seen: "#fff", border: "0",
            radius: "20px 20px 20px 6px", shadow: "0 4px 12px rgba(130,140,255,.4)",
            vpBtn: "#fff", vpFg: "#6A5CFF", vpBar: "rgba(255,255,255,.45)", vpOn: "#fff",
            deco: bsL("sparkle", "#FFFFFF", "left 3px top 3px", 14) }
    },
    glass: {
        label: "Glass",
        extra: "backdrop-filter:blur(12px) saturate(1.5);-webkit-backdrop-filter:blur(12px) saturate(1.5);",
        mine: { bg: "rgba(217,143,168,.36)", fg: "var(--ct-fg,#4B3439)", meta: "var(--ct-fg2,#8A6B75)", seen: "#2F9BE0",
            border: "1px solid rgba(255,255,255,.7)", radius: "20px",
            shadow: "0 6px 18px rgba(80,50,110,.18), inset 0 1px 0 rgba(255,255,255,.7)",
            vpBtn: "rgba(255,255,255,.8)", vpFg: "var(--ct-accent,#D98FA8)", vpBar: "rgba(255,255,255,.6)", vpOn: "var(--ct-accent,#D98FA8)",
            deco: bsL("sparkle", "#FFFFFF", "right 4px top 4px", 14) + "," + bsL("sparkle", "#FFFFFF", "left 8px bottom 6px", 9) },
        theirs: { bg: "rgba(255,255,255,.44)", fg: "var(--ct-fg,#4B3439)", meta: "var(--ct-fg2,#8A6B75)", seen: "#2F9BE0",
            border: "1px solid rgba(255,255,255,.7)", radius: "20px",
            shadow: "0 6px 18px rgba(80,50,110,.14), inset 0 1px 0 rgba(255,255,255,.7)",
            vpBtn: "rgba(255,255,255,.85)", vpFg: "var(--ct-accent,#D98FA8)", vpBar: "rgba(255,255,255,.6)", vpOn: "var(--ct-accent,#D98FA8)",
            deco: bsL("sparkle", "#FFFFFF", "left 4px top 4px", 14) + "," + bsL("sparkle", "#FFFFFF", "right 8px bottom 6px", 9) }
    },
    flower: {
        label: "Flower Frame",
        mine: { bg: "#FFE0EC", fg: "#7A2E52", meta: "#B0577D", seen: "#2F9BE0", border: "2px solid #FFA9C9",
            radius: "20px", shadow: "0 0 0 3px #fff, 0 0 0 4.5px #FFC8DC",
            vpBtn: "#F26FA3", vpFg: "#fff", vpBar: "#F7B0CC", vpOn: "#E04F8A",
            deco: bsL("blossom", "#FF8DB8", "left 0 top 0", 26) + "," + bsL("blossom", "#FFB3CF", "right 2px bottom 2px", 20) },
        theirs: { bg: "#FFF8FB", fg: "#7A2E52", meta: "#B0577D", seen: "#2F9BE0", border: "2px solid #FFC9DC",
            radius: "20px", shadow: "0 0 0 3px #fff, 0 0 0 4.5px #FFE0EC",
            vpBtn: "#F26FA3", vpFg: "#fff", vpBar: "#F9CADB", vpOn: "#E04F8A",
            deco: bsL("blossom", "#FFA3C4", "left 0 top 0", 24) + "," + bsL("blossom", "#FFC9DC", "right 2px bottom 2px", 18) }
    },
    butterfly: {
        label: "Butterfly",
        mine: { bg: "linear-gradient(135deg,#5E5BD6,#8D7BEA)", fg: "#fff", meta: "rgba(255,255,255,.8)", seen: "#C9F3FF",
            border: "1.5px solid rgba(190,180,255,.7)", radius: "20px", shadow: "0 0 14px rgba(130,115,235,.55)",
            vpBtn: "#fff", vpFg: "#5E5BD6", vpBar: "rgba(255,255,255,.45)", vpOn: "#fff",
            deco: bsL("butterfly", "#7FB6FF", "left 0 top 0", 24) + "," + bsL("butterfly", "#C9A6FF", "right 2px bottom 2px", 20) },
        theirs: { bg: "linear-gradient(135deg,#E3EBFF,#F1E4FF)", fg: "#3B3A78", meta: "#6E6CA8", seen: "#2F9BE0",
            border: "1.5px solid rgba(150,130,240,.5)", radius: "20px", shadow: "0 0 12px rgba(150,130,240,.3)",
            vpBtn: "#6C63D9", vpFg: "#fff", vpBar: "rgba(108,99,217,.3)", vpOn: "#6C63D9",
            deco: bsL("butterfly", "#6C9DFF", "right 2px top 0", 22) + "," + bsL("butterfly", "#B58BFF", "left 2px bottom 2px", 18) }
    },
    neon: {
        label: "Neon",
        mine: { bg: "#14092B", fg: "#F8E6FF", meta: "rgba(248,230,255,.7)", seen: "#7FE9FF", border: "1.5px solid #D36BFF",
            radius: "16px", shadow: "0 0 10px rgba(211,107,255,.7), inset 0 0 10px rgba(211,107,255,.22)",
            text: "0 0 6px rgba(230,150,255,.8)",
            vpBtn: "#D36BFF", vpFg: "#14092B", vpBar: "rgba(211,107,255,.4)", vpOn: "#F0B3FF",
            deco: bsL("sparkle", "#F0B3FF", "right 3px top 3px", 14) },
        theirs: { bg: "#07142B", fg: "#DAF8FF", meta: "rgba(218,248,255,.7)", seen: "#7FE9FF", border: "1.5px solid #4DE1FF",
            radius: "16px", shadow: "0 0 10px rgba(77,225,255,.65), inset 0 0 10px rgba(77,225,255,.2)",
            text: "0 0 6px rgba(120,235,255,.8)",
            vpBtn: "#4DE1FF", vpFg: "#07142B", vpBar: "rgba(77,225,255,.38)", vpOn: "#A9F4FF",
            deco: bsL("sparkle", "#8FF0FF", "left 3px top 3px", 14) }
    },
    y2k: {
        label: "Y2K",
        lift: true,
        gloss: true,
        mine: { bg: "linear-gradient(120deg,#FF9ED8,#B7A2FF 35%,#8FE6FF 65%,#B8FFD2)", fg: "#3B2A5A", meta: "rgba(59,42,90,.65)", seen: "#2F7BE0",
            border: "2px solid rgba(255,255,255,.95)", radius: "22px",
            shadow: "0 4px 14px rgba(150,120,220,.45), inset 0 2px 6px rgba(255,255,255,.7)",
            vpBtn: "#fff", vpFg: "#8A6BFF", vpBar: "rgba(255,255,255,.7)", vpOn: "#7C5CFF",
            deco: bsL("sparkle", "#FFFFFF", "right 2px top 2px", 18) + "," + bsL("sparkle", "#FFFFFF", "left 4px bottom 4px", 12) },
        theirs: { bg: "linear-gradient(120deg,#FFD0EE,#D4C8FF 40%,#C3F1FF 70%,#E4FFF0)", fg: "#3B2A5A", meta: "rgba(59,42,90,.65)", seen: "#2F7BE0",
            border: "2px solid rgba(255,255,255,.95)", radius: "22px",
            shadow: "0 4px 14px rgba(150,120,220,.35), inset 0 2px 6px rgba(255,255,255,.7)",
            vpBtn: "#fff", vpFg: "#8A6BFF", vpBar: "rgba(255,255,255,.7)", vpOn: "#7C5CFF",
            deco: bsL("sparkle", "#FFFFFF", "left 2px top 2px", 18) + "," + bsL("sparkle", "#FFFFFF", "right 4px bottom 4px", 12) }
    }
};

// Builds the CSS for every style; scope is "#chatPage" (real chat) or ".bs-demo" (picker previews)
function bsCss(scope) {
    let css = "";
    Object.keys(BS).forEach(k => {
        const s = BS[k];
        if (!s.mine) return;   // classic keeps the normal look
        const P = "html body " + scope + '[data-bs="' + k + '"] ';
        css += P + ".message{margin:12px 0 !important}";
        if (s.lift) css += P + ".message-bubble>*{position:relative;z-index:1}";
        [["mine", ".message.mine"], ["theirs", ".message:not(.mine)"]].forEach(([side, sideSel]) => {
            const v = s[side];
            const sel = P + sideSel + " .message-bubble";
            css += sel + "{background:" + v.bg + " !important;color:" + v.fg + " !important;border:" + v.border +
                " !important;border-radius:" + v.radius + " !important;box-shadow:" + v.shadow + " !important;" +
                (s.extra || "") + (v.text ? "text-shadow:" + v.text + ";" : "") +
                "--vp-btn:" + v.vpBtn + ";--vp-btn-fg:" + v.vpFg + ";--vp-bar:" + v.vpBar + ";--vp-bar-on:" + v.vpOn + "}";
            css += sel + " .message-time{color:" + v.meta + " !important}";
            css += sel + " .message-tick{color:" + v.meta + " !important}";
            css += sel + " .message-tick.seen{color:" + (v.seen || "#3FA9E0") + " !important}";
            css += sel + '::after{content:"";position:absolute;inset:-10px;pointer-events:none;z-index:2;background:' + v.deco + "}";
            if (s.gloss) {
                css += sel + '::before{content:"";position:absolute;left:2px;right:2px;top:2px;height:46%;border-radius:inherit;' +
                    "background:linear-gradient(rgba(255,255,255,.55),rgba(255,255,255,0));pointer-events:none;z-index:0}";
            }
        });
    });
    return css;
}

function bsGet() {
    let v = "classic";
    try { v = localStorage.getItem("bubbleStyle") || "classic"; } catch (e) {}
    return BS[v] ? v : "classic";
}
function bsApply(key) {
    if (!BS[key]) key = "classic";
    const el = $("chatPage");
    if (el) el.dataset.bs = key;
    try { localStorage.setItem("bubbleStyle", key); } catch (e) {}
}

// ---------- 4. Chat themes ----------
function ctTile(w, h, items) {
    const body = items.map(([sym, x, y, size, rot, fill, op]) =>
        '<g transform="translate(' + x + " " + y + ") rotate(" + rot + ") scale(" + (size / 24) + ') translate(-12 -12)" fill="' +
        fill + '" opacity="' + op + '">' + CT_SYM[sym] + "</g>").join("");
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '">' + body + "</svg>";
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '") 0 0 / ' + w + "px " + h + "px repeat";
}

// Field order of the colour arrays below
const CT_FIELDS = ["head", "line", "fg", "fg2", "accent", "form", "input", "inputfg", "chip", "mine", "minefg", "theirs", "theirsfg"];
function ctMake(label, bg, vals) {
    const t = { label, bg };
    CT_FIELDS.forEach((f, i) => { t[f] = vals[i]; });
    return t;
}

const CT = {
    sakura: ctMake("🌸 Sakura Dream",
        ctTile(240, 240, [
            ["blossom", 40, 44, 34, 15, "#FFFFFF", .55], ["blossom", 150, 30, 22, -20, "#FF8EBB", .35],
            ["blossom", 205, 98, 30, 30, "#FFFFFF", .5], ["blossom", 92, 112, 20, 10, "#FF9EC4", .4],
            ["blossom", 30, 170, 26, -10, "#FF8EBB", .3], ["blossom", 128, 190, 36, 25, "#FFFFFF", .5],
            ["blossom", 214, 214, 18, 0, "#FF9EC4", .4], ["sparkle", 80, 218, 12, 0, "#FFFFFF", .7]
        ]) + ",linear-gradient(160deg,#FFD9E8,#FFC2DA 55%,#FFD6E6)",
        ["rgba(255,236,244,.9)", "rgba(232,99,143,.25)", "#6B2A4A", "#A8588A", "#E8638F", "rgba(255,236,244,.94)", "#FFFFFF", "#4B2338",
         "rgba(255,255,255,.8)", "#F2799F", "#FFFFFF", "rgba(255,255,255,.88)", "#5A2540"]),
    coquette: ctMake("🎀 Coquette",
        ctTile(220, 220, [
            ["bow", 50, 48, 40, -12, "#FFFFFF", .7], ["bow", 160, 40, 28, 14, "#FF8FB5", .55],
            ["bow", 110, 120, 34, 6, "#FF8FB5", .45], ["bow", 36, 170, 26, -18, "#FFFFFF", .6],
            ["bow", 180, 176, 38, 10, "#FFFFFF", .65], ["heart", 120, 200, 14, 0, "#FF8FB5", .5],
            ["heart", 86, 22, 12, 0, "#FFFFFF", .6], ["heart", 202, 112, 12, 10, "#FFFFFF", .55]
        ]) + ",linear-gradient(160deg,#FFD3E1,#FFBFD3)",
        ["rgba(255,228,238,.92)", "rgba(224,106,147,.28)", "#7A2E52", "#B0577D", "#E06A93", "rgba(255,228,238,.95)", "#FFFFFF", "#4B2338",
         "rgba(255,255,255,.85)", "#E26D97", "#FFFFFF", "rgba(255,255,255,.9)", "#7A2E52"]),
    butterfly: ctMake("🦋 Butterfly Garden",
        ctTile(240, 240, [
            ["butterfly", 44, 48, 34, -20, "#4C8DFF", .55], ["butterfly", 170, 34, 28, 18, "#8E6BFF", .5],
            ["butterfly", 110, 118, 38, -8, "#6AA5FF", .5], ["butterfly", 205, 150, 26, 22, "#B58BFF", .5],
            ["butterfly", 40, 190, 30, 12, "#8E6BFF", .45], ["sparkle", 150, 196, 14, 0, "#FFFFFF", .8],
            ["sparkle", 86, 22, 12, 0, "#FFFFFF", .8], ["blossom", 216, 226, 16, 0, "#FFFFFF", .7],
            ["blossom", 60, 126, 14, 0, "#FFFFFF", .7]
        ]) + ",linear-gradient(160deg,#B8D9FF,#D6C8FF 58%,#C2DEFF)",
        ["rgba(228,238,255,.92)", "rgba(74,130,240,.28)", "#27406E", "#5A78A8", "#4A82F0", "rgba(228,238,255,.95)", "#FFFFFF", "#22365A",
         "rgba(255,255,255,.85)", "#5B7DF0", "#FFFFFF", "rgba(255,255,255,.88)", "#27406E"]),
    bubble: ctMake("🫧 Bubble Pop",
        ctTile(220, 220, [
            ["bubble", 50, 52, 44, 0, "#FFFFFF", .35], ["bubble", 150, 44, 28, 0, "#FFFFFF", .4],
            ["bubble", 110, 128, 52, 0, "#FFFFFF", .3], ["bubble", 192, 176, 34, 0, "#FFFFFF", .38],
            ["bubble", 40, 176, 30, 0, "#FFFFFF", .4], ["bubble", 196, 100, 18, 0, "#FFFFFF", .45],
            ["sparkle", 98, 34, 12, 0, "#FFFFFF", .8], ["sparkle", 160, 206, 10, 0, "#FFFFFF", .8]
        ]) + ",linear-gradient(150deg,#FFC8EA,#D2C4FF 50%,#BCEBFF)",
        ["rgba(246,232,255,.9)", "rgba(155,107,232,.28)", "#4A3A7A", "#8272B0", "#9B6BE8", "rgba(246,232,255,.94)", "#FFFFFF", "#3A2E5E",
         "rgba(255,255,255,.8)", "#9B7BEA", "#FFFFFF", "rgba(255,255,255,.75)", "#4A3A7A"]),
    cloudy: ctMake("☁️ Cloudy",
        ctTile(260, 220, [
            ["cloud", 60, 50, 56, 0, "#FFFFFF", .9], ["cloud", 190, 38, 38, 0, "#FFFFFF", .75],
            ["cloud", 130, 128, 66, 0, "#FFFFFF", .85], ["cloud", 42, 182, 40, 0, "#FFFFFF", .7],
            ["cloud", 224, 176, 50, 0, "#FFFFFF", .8], ["sparkle", 120, 28, 10, 0, "#FFFFFF", .9],
            ["sparkle", 24, 112, 9, 0, "#FFFFFF", .9], ["sparkle", 236, 108, 9, 0, "#FFFFFF", .9]
        ]) + ",linear-gradient(180deg,#B9DBFF,#E4F1FF)",
        ["rgba(235,245,255,.92)", "rgba(63,140,240,.25)", "#26456E", "#5F82AD", "#3F8CF0", "rgba(235,245,255,.95)", "#FFFFFF", "#1F3A5E",
         "rgba(255,255,255,.9)", "#4F9AF2", "#FFFFFF", "rgba(255,255,255,.92)", "#26456E"]),
    moon: ctMake("🌙 Moonlight",
        ctTile(240, 240, [
            ["moon", 190, 48, 40, 0, "#CDBBFF", .9], ["star", 50, 40, 10, 0, "#FFFFFF", .7],
            ["star", 120, 86, 7, 0, "#FFFFFF", .5], ["sparkle", 200, 140, 12, 0, "#FFFFFF", .7],
            ["star", 36, 150, 8, 0, "#FFFFFF", .55], ["sparkle", 120, 196, 10, 0, "#FFFFFF", .55],
            ["star", 166, 220, 6, 0, "#FFFFFF", .45], ["star", 84, 16, 6, 0, "#FFFFFF", .5]
        ]) + ",linear-gradient(180deg,#130C38,#281A63 72%,#1A1050)",
        ["rgba(24,16,68,.92)", "rgba(143,123,255,.3)", "#EDE8FF", "#B3A6E6", "#9A86FF", "rgba(24,16,68,.95)", "rgba(255,255,255,.1)", "#EDE8FF",
         "rgba(255,255,255,.12)", "#7A63F0", "#FFFFFF", "rgba(255,255,255,.13)", "#EDE8FF"]),
    strawberry: ctMake("🍓 Strawberry Milk",
        ctTile(200, 200, [
            ["strawberry", 44, 46, 30, -12, "#FF4F77", .75], ["strawberry", 150, 30, 22, 14, "#FF4F77", .6],
            ["strawberry", 100, 112, 34, 6, "#FF4F77", .7], ["strawberry", 30, 160, 24, -8, "#FF4F77", .55],
            ["strawberry", 168, 166, 28, 18, "#FF4F77", .7], ["heart", 70, 92, 10, 0, "#FFFFFF", .8],
            ["heart", 150, 98, 10, 0, "#FFFFFF", .8], ["sparkle", 110, 30, 10, 0, "#FFFFFF", .9]
        ]) + ",repeating-linear-gradient(0deg,rgba(255,255,255,.38) 0 20px,rgba(255,255,255,0) 20px 40px)" +
        ",repeating-linear-gradient(90deg,rgba(255,255,255,.38) 0 20px,rgba(255,255,255,0) 20px 40px),#FFC4D4",
        ["rgba(255,232,238,.93)", "rgba(229,72,111,.25)", "#7A2E3E", "#B0586D", "#E5486F", "rgba(255,232,238,.95)", "#FFFFFF", "#4B2330",
         "rgba(255,255,255,.85)", "#EC6489", "#FFFFFF", "rgba(255,255,255,.92)", "#7A2E3E"]),
    teddy: ctMake("🧸 Teddy Bear",
        ctTile(220, 220, [
            ["bear", 50, 52, 40, -8, "#B98556", .45], ["heart", 140, 36, 16, 12, "#E58FA3", .55],
            ["bear", 160, 112, 34, 10, "#C99A68", .4], ["heart", 50, 126, 14, -10, "#E58FA3", .5],
            ["bear", 96, 178, 38, 6, "#B98556", .42], ["heart", 196, 190, 16, 0, "#E58FA3", .5],
            ["heart", 110, 92, 10, 0, "#FFFFFF", .6], ["sparkle", 18, 198, 10, 0, "#FFFFFF", .7]
        ]) + ",linear-gradient(160deg,#F7E5CC,#EBCFAA)",
        ["rgba(250,236,215,.93)", "rgba(176,118,68,.28)", "#5A3B22", "#9A7048", "#B07644", "rgba(250,236,215,.95)", "#FFFFFF", "#4A3220",
         "rgba(255,255,255,.85)", "#C28A55", "#FFFFFF", "rgba(255,255,255,.9)", "#5A3B22"])
};

const CT_VARS = ["bg"].concat(CT_FIELDS).map(f => "--ct-" + f);

function ctApply(key) {
    const el = $("chatPage");
    if (!el) return;
    CT_VARS.forEach(v => el.style.removeProperty(v));
    el.classList.remove("ct");
    el.dataset.ct = "";
    const t = CT[key];
    if (!t) return;
    el.classList.add("ct");
    el.dataset.ct = key;
    el.style.setProperty("--ct-bg", t.bg);
    CT_FIELDS.forEach(f => el.style.setProperty("--ct-" + f, t[f]));
}

// A chat's own theme wins; otherwise the "all chats" theme; "none" means default for that chat
function ctFor(room) {
    if (!room) return "";
    let v = "";
    try { v = localStorage.getItem("chatTheme:" + room.id) || localStorage.getItem("chatTheme:all") || ""; } catch (e) {}
    return v === "none" ? "" : v;
}

// ---------- injected CSS (nothing to add to style.css) ----------
(function () {
    const base = [
        ".message-menu button.on{background:var(--soft,#F8E8ED);border-radius:50%}",
        ".emoji-plain{font-size:inherit}.message-menu .emoji-plain{font-size:26px}",

        ".vp{display:flex;align-items:center;gap:10px;min-width:210px;padding:2px 0}",
        ".vp-btn{width:38px;height:38px;border-radius:50%;flex:0 0 auto;display:flex;align-items:center;justify-content:center;background:var(--vp-btn);color:var(--vp-btn-fg);padding:0}",
        ".vp-btn svg{width:16px;height:16px;fill:currentColor}",
        ".vp-wave{display:flex;align-items:center;gap:2px;height:30px;flex:1;cursor:pointer}",
        ".vp-wave i{display:block;width:3px;border-radius:2px;background:var(--vp-bar);flex:0 0 auto}",
        ".vp-wave i.on{background:var(--vp-bar-on)}",
        ".vp-time{font-size:11px;min-width:32px;text-align:right;opacity:.9}",
        ".message.mine .message-bubble{--vp-btn:#fff;--vp-btn-fg:var(--primary,#D98FA8);--vp-bar:rgba(255,255,255,.5);--vp-bar-on:#fff}",
        ".message:not(.mine) .message-bubble{--vp-btn:var(--primary,#D98FA8);--vp-btn-fg:#fff;--vp-bar:rgba(0,0,0,.18);--vp-bar-on:var(--primary,#D98FA8)}",

        ".ct-panel{position:fixed;left:0;right:0;bottom:0;z-index:10003;background:var(--card,#fff);border-radius:20px 20px 0 0;box-shadow:0 -8px 30px rgba(0,0,0,.18);padding:12px 12px calc(14px + env(safe-area-inset-bottom))}",
        ".ct-phead{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}",
        ".ct-phead strong{color:var(--text,#4B3439)}",
        ".ct-done{background:var(--primary,#D98FA8);color:#fff;padding:7px 16px;border-radius:14px;font-weight:600}",
        ".ct-row{display:flex;gap:10px;overflow-x:auto;padding:6px 2px 10px}",
        ".ct-card{flex:0 0 auto;width:104px;display:flex;flex-direction:column;align-items:center;gap:6px;background:none;border-radius:16px;padding:4px}",
        ".ct-card span{font-size:12px;color:var(--text,#4B3439);text-align:center}",
        ".ct-thumb{width:96px;height:132px;border-radius:14px;border:2px solid transparent;box-shadow:0 2px 8px rgba(0,0,0,.12)}",
        ".ct-card.on .ct-thumb{border-color:var(--card,#fff);box-shadow:0 0 0 2.5px var(--primary,#D98FA8)}",
        ".ct-card.bs{width:168px}",
        ".ct-demo{width:160px;border-radius:14px;padding:6px 14px;background:var(--bg,#FFF8F5);border:2px solid var(--border,#F0E2E5)}",
        ".ct-card.bs.on .ct-demo{border-color:var(--primary,#D98FA8)}",
        ".bs-demo .message-bubble{max-width:100% !important}",
        ".bs-demo .vp{min-width:0;gap:6px}.bs-demo .vp-wave{height:22px}",
        ".bs-demo .vp-btn{width:26px;height:26px}.bs-demo .vp-btn svg{width:12px;height:12px}",
        ".ct-toggle{width:100%;padding:11px;border-radius:14px;background:var(--soft,#F8E8ED);color:var(--accent,#B96F86);font-weight:600;margin-top:2px}",
        ".ct-toggle.on{background:var(--primary,#D98FA8);color:#fff}"
    ].join("");

    const C = "html body #chatPage.ct ";
    const CL = 'html body #chatPage.ct[data-bs="classic"] ';
    const ct = [
        C + ".messages{background:var(--ct-bg) !important}",
        C + ".messages::before{display:none !important}",
        C + ".chat-header{background:var(--ct-head) !important;border-bottom:1px solid var(--ct-line) !important;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}",
        C + ".hdr-text strong{color:var(--ct-fg) !important}",
        C + ".hdr-text span{color:var(--ct-fg2) !important}",
        C + ".hdr-btn{color:var(--ct-accent) !important}",
        C + ".message-form{background:var(--ct-form) !important;border-top:1px solid var(--ct-line) !important}",
        C + ".message-form input{background:var(--ct-input) !important;color:var(--ct-inputfg) !important;border-color:var(--ct-line) !important}",
        C + ".send-btn{background:var(--ct-accent) !important;color:#fff !important}",
        C + ".attach-btn," + C + ".voice-record-btn{background:var(--ct-chip) !important;color:var(--ct-accent) !important}",
        C + ".typing-indicator{background:transparent !important;color:var(--ct-fg2) !important}",
        C + ".reply-bar{background:var(--ct-form) !important;border-left-color:var(--ct-accent) !important}",
        C + ".reply-bar-text{color:var(--ct-fg) !important}",
        CL + ".message.mine .message-bubble{background:var(--ct-mine) !important;color:var(--ct-minefg) !important;--vp-btn-fg:var(--ct-accent)}",
        CL + ".message:not(.mine) .message-bubble{background:var(--ct-theirs) !important;color:var(--ct-theirsfg) !important;border-color:transparent !important;--vp-btn:var(--ct-accent);--vp-btn-fg:#fff;--vp-bar-on:var(--ct-accent)}",
        CL + ".message:not(.mine) .message-time{color:var(--ct-theirsfg) !important;opacity:.6}",
        'html body #chatPage.ct[data-ct="moon"][data-bs="classic"] .message:not(.mine) .message-bubble{--vp-bar:rgba(255,255,255,.35)}'
    ].join("");

    const st = document.createElement("style");
    st.id = "chatStylePack";
    st.textContent = base + bsCss("#chatPage") + bsCss(".bs-demo") + ct;
    document.head.appendChild(st);
})();

// ---------- pickers ----------
function csPanel(title) {
    const old = $("csPanel");
    if (old) old.remove();
    const p = gEl("div", "ct-panel");
    p.id = "csPanel";
    const head = gEl("div", "ct-phead");
    head.append(gEl("strong", "", title), gBtn("Done", "ct-done", () => p.remove()));
    const body = gEl("div", "ct-pbody");
    p.append(head, body);
    document.body.appendChild(p);
    return body;
}

function openChatThemePicker() {
    if (!currentRoom) return;
    const room = currentRoom;
    const body = csPanel("Chat theme");
    let all = false;
    const row = gEl("div", "ct-row");
    const cards = {};

    const add = (key, label, bg) => {
        const c = gEl("button", "ct-card");
        c.type = "button";
        const th = gEl("div", "ct-thumb");
        th.style.background = bg;
        c.append(th, gEl("span", "", label));
        c.addEventListener("click", () => choose(key));
        cards[key] = c;
        row.appendChild(c);
    };
    add("", "Default", "linear-gradient(160deg,#FFF8F5,#F4DDE4)");
    Object.keys(CT).forEach(k => add(k, CT[k].label, CT[k].bg));

    const toggle = gBtn("Use in all chats: Off", "ct-toggle", () => {
        all = !all;
        toggle.textContent = "Use in all chats: " + (all ? "On" : "Off");
        toggle.classList.toggle("on", all);
    });

    function mark() {
        const v = ctFor(room);
        Object.keys(cards).forEach(k => cards[k].classList.toggle("on", k === v));
    }
    function choose(key) {
        try {
            if (all) {
                localStorage.setItem("chatTheme:all", key);
                localStorage.removeItem("chatTheme:" + room.id);
            } else {
                localStorage.setItem("chatTheme:" + room.id, key || "none");
            }
        } catch (e) {}
        ctApply(ctFor(room));
        mark();
    }

    body.append(row, toggle, gEl("p", "pt-note", "Saved on this phone only."));
    mark();
}

function openBubblePicker() {
    const body = csPanel("Bubble style");
    const row = gEl("div", "ct-row");
    const cards = {};
    const bars = Array.from({ length: 10 }, (_, i) => '<i style="height:' + (6 + ((i * 7) % 14)) + 'px"></i>').join("");

    Object.keys(BS).forEach(k => {
        const c = gEl("button", "ct-card bs");
        c.type = "button";
        const demo = gEl("div", "ct-demo bs-demo");
        demo.dataset.bs = k;
        demo.innerHTML =
            '<div class="message"><div class="message-bubble"><div class="message-text">hey, what\'s up?</div></div></div>' +
            '<div class="message mine"><div class="message-bubble"><div class="vp"><span class="vp-btn">' + VP_PLAY +
            '</span><div class="vp-wave">' + bars + '</div><span class="vp-time">0:12</span></div></div></div>';
        c.append(demo, gEl("span", "", BS[k].label));
        c.addEventListener("click", () => { bsApply(k); mark(); });
        cards[k] = c;
        row.appendChild(c);
    });

    function mark() {
        const v = bsGet();
        Object.keys(cards).forEach(k => cards[k].classList.toggle("on", k === v));
    }
    body.append(row, gEl("p", "pt-note", "Applies to text, photos and voice messages. Saved on this phone only."));
    mark();
}

// ---------- chat menu (top-right ⋮) with the two new options ----------
async function openChatMenu() {
    if (!currentRoom) return;
    const dm = dmOf(currentRoom);
    const look = [["Chat theme", openChatThemePicker], ["Bubble style", openBubblePicker]];
    if (dm) {
        await loadBlocks();
        showSheet([
            ["Search messages", openSearch],
            ...look,
            [blockedNames.has(dm.username) ? "Unblock" : "Block", () => toggleBlock(dm), true],
            ["Delete chat", clearChatFromChat, true],
            ["Cancel", () => {}]
        ]);
        return;
    }
    showSheet([
        ["Room info", openRoomInfo],
        ["Members", showMembers],
        ["Search messages", openSearch],
        ...look,
        ["Delete chat", clearChatFromChat, true],
        ["Leave room", leaveFromChat, true],
        ["Cancel", () => {}]
    ]);
}

// ---------- apply the saved look every time a chat opens ----------
const _openChatCS = window.openChat;
window.openChat = async function () {
    try { ctApply(ctFor(currentRoom)); bsApply(bsGet()); } catch (e) { console.error(e); }
    return _openChatCS.apply(this, arguments);
};
bsApply(bsGet());
// ================================
// PROFILE v4: wall, game stats + streak, avatar maker
// Paste at the very end of auth.js.
// Needs: PROFILE v3 (pxBuild), the full-page screens block (openSubPage) and the games block.
// ================================
const P3 = { logged: new Set() };

const P3_ICON = {
    heart: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1.2-4.4A8 8 0 1 1 21 12z"/></svg>',
    flame: '<svg viewBox="0 0 24 24"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>',
    send: '<svg viewBox="0 0 24 24"><path d="M21 3L10.5 13.5"/><path d="M21 3L15 21L10.5 13.5L3 9L21 3Z"/></svg>'
};

function p3Left(iso) {
    const ms = new Date(iso).getTime() + 24 * 3600 * 1000 - Date.now();
    if (ms <= 0) return "expiring";
    const h = Math.floor(ms / 3600000);
    return h >= 1 ? h + "h left" : Math.max(1, Math.floor(ms / 60000)) + "m left";
}

function p3Today() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// ---------- game stats logging ----------
// game: "tod" | "hot" | "mic"   kind: "truth" | "dare" | "seat" | ""   ref: a unique id for that turn
async function statLog(game, kind, ref) {
    if (!authUser || !game || !ref || P3.logged.has(ref)) return;
    P3.logged.add(ref);
    const { error } = await supabaseClient.rpc("game_log", {
        p_game: game, p_kind: kind || "", p_ref: String(ref), p_day: p3Today()
    });
    if (error) { console.error("game_log", error); P3.logged.delete(ref); }
}

// ---------- wall ----------
function p3Post(w, reload) {
    const card = gEl("div", "p3-post");
    const top = gEl("div", "p3-ptop");
    const av = gEl("div", "p3-av");
    paintAvatar(av, w.author_avatar, w.author_name);
    av.addEventListener("click", () => openUserProfile(w.author));
    const who = gEl("div", "p3-who");
    who.append(gEl("strong", "", w.author_name), gEl("span", "", timeAgo(w.created_at) + " · " + p3Left(w.created_at)));
    top.append(av, who);
    if (w.can_delete) {
        top.append(gBtn("×", "p3-x", async () => {
            if (!confirm("Delete this message?")) return;
            const { error } = await supabaseClient.rpc("wall_delete", { p_post: w.id });
            if (error) { console.error(error); gToast("Could not delete"); return; }
            reload();
        }));
    }
    const body = gEl("div", "p3-body", w.body);

    const acts = gEl("div", "p3-acts");
    const like = gEl("button", "p3-act" + (w.liked ? " on" : ""));
    like.type = "button";
    const lc = gEl("span", "", String(w.likes));
    like.innerHTML = P3_ICON.heart;
    like.appendChild(lc);
    like.addEventListener("click", async () => {
        const { data, error } = await supabaseClient.rpc("wall_like", { p_post: w.id });
        if (error) { console.error(error); gToast("Could not update the like"); return; }
        const r = data && data[0];
        if (!r) return;
        like.classList.toggle("on", !!r.liked);
        lc.textContent = String(r.likes);
    });

    const com = gEl("button", "p3-act");
    com.type = "button";
    const cc = gEl("span", "", String(w.comments));
    com.innerHTML = P3_ICON.chat;
    com.appendChild(cc);
    acts.append(like, com);

    const thread = gEl("div", "p3-thread");
    thread.style.display = "none";

    async function loadThread() {
        const { data, error } = await supabaseClient.rpc("wall_comments", { p_post: w.id });
        thread.innerHTML = "";
        if (error) { console.error(error); thread.appendChild(gEl("p", "empty", "Could not load comments.")); return; }
        const rows = data || [];
        cc.textContent = String(rows.length);
        rows.forEach(c => {
            const row = gEl("div", "p3-cm");
            const a = gEl("div", "p3-av");
            paintAvatar(a, c.author_avatar, c.author_name);
            a.addEventListener("click", () => openUserProfile(c.author));
            const b = gEl("div", "p3-cm-body");
            b.append(gEl("strong", "", c.author_name), gEl("span", "", c.body));
            row.append(a, b);
            if (c.can_delete) {
                row.append(gBtn("×", "p3-x", async () => {
                    const { error: e2 } = await supabaseClient.rpc("wall_comment_delete", { p_comment: c.id });
                    if (e2) { console.error(e2); gToast("Could not delete"); return; }
                    loadThread();
                }));
            }
            thread.appendChild(row);
        });
        const f = gEl("form", "p3-cform");
        const i = gEl("input");
        i.placeholder = "Write a comment...";
        i.maxLength = 200;
        const s = gEl("button", "", "Post");
        s.type = "submit";
        f.append(i, s);
        f.addEventListener("submit", async e => {
            e.preventDefault();
            const t = i.value.trim();
            if (!t) return;
            s.disabled = true;
            const { error: e3 } = await supabaseClient.rpc("wall_comment", { p_post: w.id, p_body: t });
            s.disabled = false;
            if (e3) { console.error(e3); gToast(e3.message || "Could not comment"); return; }
            loadThread();
        });
        thread.appendChild(f);
    }
    com.addEventListener("click", () => {
        const open = thread.style.display === "none";
        thread.style.display = open ? "" : "none";
        if (open) loadThread();
    });

    card.append(top, body, acts, thread);
    return card;
}

function p3WallBuild(ctx) {
    const panel = gEl("div", "p3-panel p3-wall px-hide");
    panel.appendChild(gEl("p", "pt-note", ctx.self
        ? "Messages from your friends. Each one disappears after 24 hours."
        : "Leave a message. It disappears after 24 hours."));

    const form = gEl("form", "p3-compose");
    const inp = gEl("input");
    inp.placeholder = ctx.self ? "Write on your own wall..." : "Leave a message on their wall...";
    inp.maxLength = 200;
    const go = gEl("button", "send-btn");
    go.type = "submit";
    go.setAttribute("aria-label", "Post");
    go.innerHTML = P3_ICON.send;
    form.append(inp, go);
    form.addEventListener("submit", async e => {
        e.preventDefault();
        const text = inp.value.trim();
        if (!text) return;
        go.disabled = true;
        const { error } = await supabaseClient.rpc("wall_post", { p_username: ctx.username, p_body: text });
        go.disabled = false;
        if (error) { console.error(error); gToast(error.message || "Could not post"); return; }
        inp.value = "";
        load();
    });

    const list = gEl("div", "p3-list");
    panel.append(form, list);

    async function load() {
        const { data, error } = await supabaseClient.rpc("wall_list", { p_username: ctx.username });
        list.innerHTML = "";
        if (error) { console.error(error); list.appendChild(gEl("p", "empty", "Could not load the wall.")); return; }
        if (!data || !data.length) { list.appendChild(gEl("p", "empty", "No messages yet. Be the first!")); return; }
        data.forEach(w => list.appendChild(p3Post(w, load)));
    }
    panel._load = load;
    return panel;
}

// ---------- stats ----------
function p3StatsFill(panel, s) {
    panel.innerHTML = "";
    if (!s) { panel.appendChild(gEl("p", "empty", "Stats are not available right now.")); return; }
    const big = gEl("div", "p3-big");
    const ic = gEl("div", "p3-bigic");
    ic.innerHTML = P3_ICON.flame;
    big.append(ic, gEl("b", "", String(s.streak)), gEl("span", "", "day streak"),
        gEl("small", "", "Best: " + s.best + (s.best === 1 ? " day" : " days")));
    panel.appendChild(big);

    const grid = gEl("div", "p3-grid");
    [["Games played", s.total], ["Truth or Dare", s.tod], ["Hot Seat", s.hot],
     ["Mic Roulette", s.mic], ["Truths survived", s.truths], ["Dares completed", s.dares]].forEach(([l, n]) => {
        const t = gEl("div", "p3-tile");
        t.append(gEl("b", "", String(n)), gEl("span", "", l));
        grid.appendChild(t);
    });
    panel.append(grid, gEl("p", "pt-note", "Finish a game turn in a room to keep your streak alive."));
}

function p3Chip(page, streak) {
    page.querySelectorAll(".p3-streak").forEach(e => e.remove());
    if (!streak || streak < 1) return;
    const box = page.querySelector("#pfExtraBox, #upExtra");
    if (!box) return;
    const chip = gEl("div", "p3-streak");
    chip.innerHTML = P3_ICON.flame;
    chip.appendChild(document.createTextNode(streak + " day streak"));
    const j = box.querySelector(".pt-joined");
    if (j) j.after(chip); else box.prepend(chip);
}

// ---------- adds the Wall + Stats tabs to a profile page (own and friends') ----------
async function p3Extend(ctx) {
    const page = ctx.page;
    if (!page || !page.isConnected) return;
    const tabs = page.querySelector(".px-tabs");
    if (!tabs) { page.querySelectorAll(".p3-panel, .p3-streak").forEach(e => e.remove()); return; }
    if (tabs.querySelector(".p3-tab")) return;           // already extended
    page.querySelectorAll(".p3-panel, .p3-streak").forEach(e => e.remove());

    const posts = page.querySelector(".px-posts");
    const btns = tabs.querySelectorAll(".px-tab");
    if (!posts || btns.length < 2) return;
    const bP = btns[0], bR = btns[btns.length - 1];

    const wall = p3WallBuild(ctx);
    const stats = gEl("div", "p3-panel p3-stats px-hide");
    stats.appendChild(gEl("p", "empty", "Loading..."));
    posts.after(wall, stats);

    const bW = gBtn("Wall", "px-tab p3-tab", () => show("wall"));
    const bS = gBtn("Stats", "px-tab p3-tab", () => show("stats"));
    bR.before(bW, bS);

    function show(t) {
        [bP, bW, bS, bR].forEach(b => b.classList.remove("on"));
        posts.classList.add("px-hide");
        wall.classList.add("px-hide");
        stats.classList.add("px-hide");
        if (ctx.list) ctx.list.classList.add("px-hide");
        if (t === "wall") {
            bW.classList.add("on");
            wall.classList.remove("px-hide");
            wall._load();
        } else {
            bS.classList.add("on");
            stats.classList.remove("px-hide");
        }
    }
    // The original Posts / Rooms tabs must also hide my panels
    [bP, bR].forEach(b => b.addEventListener("click", () => {
        wall.classList.add("px-hide");
        stats.classList.add("px-hide");
        bW.classList.remove("on");
        bS.classList.remove("on");
    }));

    supabaseClient.rpc("stats_of", { p_username: ctx.username, p_today: p3Today() }).then(({ data, error }) => {
        if (error) console.error(error);
        const s = data && data[0] ? data[0] : null;
        if (!stats.isConnected) return;
        p3StatsFill(stats, s);
        if (s) p3Chip(page, s.streak);
    });
}

// ---------- avatar maker ----------
const AV = {
    skin: ["#FFE0C7", "#F5C9A3", "#E0A878", "#B97C52", "#8A5638"],
    hair: ["#2A1B1B", "#5A3825", "#A5622B", "#E1B15B", "#E56B8B", "#7C5CD6", "#4FA3E0", "#EFEAE4"],
    bg: ["#FFD6E7", "#DCEEFF", "#EADFFF", "#DDF5E3", "#FFF3C4", "#FFE3D1", "#2A2540", "#F4EFE9"],
    shirt: ["#F27AA6", "#5AA9F0", "#9B7BE8", "#6CC07A", "#F5C84A", "#ECECEC", "#2B2B33", "#FF8A65"],
    styles: ["Bob", "Long", "Bun", "Short", "Curly", "Pigtails"],
    eyes: ["Dot", "Happy", "Sparkle", "Wink"],
    mouth: ["Smile", "Open", "Cat", "Smirk"],
    acc: ["None", "Glasses", "Bow", "Headphones", "Flowers", "Cat ears"]
};
const AV_DEFAULT = { skin: 1, hair: 1, style: 0, eyes: 0, mouth: 0, acc: 0, bg: 0, shirt: 0 };
const AV_LIMITS = {
    skin: AV.skin.length, hair: AV.hair.length, style: AV.styles.length, eyes: AV.eyes.length,
    mouth: AV.mouth.length, acc: AV.acc.length, bg: AV.bg.length, shirt: AV.shirt.length
};

function avClamp(c) {
    Object.keys(AV_LIMITS).forEach(k => {
        const n = Number(c[k]);
        c[k] = Number.isInteger(n) && n >= 0 && n < AV_LIMITS[k] ? n : AV_DEFAULT[k];
    });
    return c;
}

function avSvg(c) {
    const skin = AV.skin[c.skin], hair = AV.hair[c.hair], bg = AV.bg[c.bg], shirt = AV.shirt[c.shirt];
    const ink = "#2B2024";
    const bangs = '<path d="M52 98C48 58 74 36 100 36s52 22 48 62c-6-16-22-30-48-30S58 82 52 98z" fill="' + hair + '"/>';
    let back = "", front = "";

    if (c.style === 0) {            // bob
        back = '<path d="M47 104C41 54 70 30 100 30s59 24 53 74c0 24-6 38-14 44H61c-8-6-14-20-14-44z" fill="' + hair + '"/>';
        front = bangs;
    } else if (c.style === 1) {     // long
        back = '<path d="M46 104C40 52 70 28 100 28s60 24 54 76l6 74c-22 8-98 8-120 0z" fill="' + hair + '"/>';
        front = '<path d="M52 98C46 56 74 34 100 34s54 22 48 64c-4-22-20-38-48-40-28 2-44 18-48 40z" fill="' + hair + '"/>';
    } else if (c.style === 2) {     // bun
        front = '<circle cx="100" cy="30" r="17" fill="' + hair + '"/>' + bangs;
    } else if (c.style === 3) {     // short
        front = '<path d="M50 104C44 56 72 32 100 32s56 24 50 72c-2-18-8-28-18-36-14 8-48 8-62 0-10 8-16 18-18 36z" fill="' + hair + '"/>';
    } else if (c.style === 4) {     // curly
        back = '<g fill="' + hair + '"><circle cx="56" cy="70" r="16"/><circle cx="70" cy="46" r="17"/><circle cx="96" cy="36" r="18"/>' +
            '<circle cx="126" cy="42" r="17"/><circle cx="144" cy="66" r="16"/><circle cx="48" cy="98" r="14"/><circle cx="152" cy="98" r="14"/></g>';
        front = bangs;
    } else {                        // pigtails
        back = '<g fill="' + hair + '"><ellipse cx="42" cy="128" rx="15" ry="28"/><ellipse cx="158" cy="128" rx="15" ry="28"/></g>';
        front = bangs + '<circle cx="48" cy="100" r="6" fill="#FF6FA5"/><circle cx="152" cy="100" r="6" fill="#FF6FA5"/>';
    }

    const eyes = [
        '<circle cx="80" cy="98" r="5.5" fill="' + ink + '"/><circle cx="120" cy="98" r="5.5" fill="' + ink + '"/><circle cx="82" cy="96" r="1.8" fill="#fff"/><circle cx="122" cy="96" r="1.8" fill="#fff"/>',
        '<path d="M72 100Q80 89 88 100M112 100Q120 89 128 100" fill="none" stroke="' + ink + '" stroke-width="3.5" stroke-linecap="round"/>',
        '<ellipse cx="80" cy="98" rx="7.5" ry="9" fill="' + ink + '"/><ellipse cx="120" cy="98" rx="7.5" ry="9" fill="' + ink + '"/><circle cx="83" cy="94" r="3" fill="#fff"/><circle cx="123" cy="94" r="3" fill="#fff"/><circle cx="77" cy="102" r="1.6" fill="#fff"/><circle cx="117" cy="102" r="1.6" fill="#fff"/>',
        '<circle cx="80" cy="98" r="5.5" fill="' + ink + '"/><circle cx="82" cy="96" r="1.8" fill="#fff"/><path d="M112 99Q120 90 128 99" fill="none" stroke="' + ink + '" stroke-width="3.5" stroke-linecap="round"/>'
    ][c.eyes];

    const mouth = [
        '<path d="M88 118Q100 130 112 118" fill="none" stroke="' + ink + '" stroke-width="3.5" stroke-linecap="round"/>',
        '<path d="M89 117Q100 134 111 117Z" fill="#7A2E3E"/><path d="M93 124Q100 130 107 124Z" fill="#FF8FA8"/>',
        '<path d="M86 118Q93 126 100 118Q107 126 114 118" fill="none" stroke="' + ink + '" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>',
        '<path d="M90 120Q102 124 112 114" fill="none" stroke="' + ink + '" stroke-width="3.5" stroke-linecap="round"/>'
    ][c.mouth];

    let accBack = "", accFront = "";
    if (c.acc === 1) {
        accFront = '<g fill="rgba(255,255,255,.28)" stroke="' + ink + '" stroke-width="3"><circle cx="80" cy="97" r="14"/><circle cx="120" cy="97" r="14"/><path d="M94 97h12"/></g>';
    } else if (c.acc === 2) {
        accFront = '<g transform="translate(64 50) rotate(-18)"><path d="M0 0C-12-14-22-6-18 4S-4 8 0 0z" fill="#FF6FA5"/><path d="M0 0C12-14 22-6 18 4S4 8 0 0z" fill="#FF6FA5"/><circle r="5" fill="#E0457F"/></g>';
    } else if (c.acc === 3) {
        accFront = '<path d="M54 100C48 38 152 38 146 100" fill="none" stroke="#3A3A4A" stroke-width="7" stroke-linecap="round"/>' +
            '<rect x="44" y="92" width="14" height="30" rx="7" fill="#3A3A4A"/><rect x="142" y="92" width="14" height="30" rx="7" fill="#3A3A4A"/>';
    } else if (c.acc === 4) {
        const pts = [[64, 74, "#FFFFFF"], [80, 58, "#FF9EC4"], [100, 52, "#FFFFFF"], [120, 58, "#FF9EC4"], [136, 74, "#FFFFFF"]];
        accFront = pts.map(p => '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="7" fill="' + p[2] + '"/><circle cx="' + p[0] + '" cy="' + p[1] + '" r="2.6" fill="#F5C84A"/>').join("");
    } else if (c.acc === 5) {
        accBack = '<path d="M58 66L62 24L90 46z" fill="' + hair + '"/><path d="M142 66L138 24L110 46z" fill="' + hair + '"/>' +
            '<path d="M64 56L66 36L80 48z" fill="#FF9EC4"/><path d="M136 56L134 36L120 48z" fill="#FF9EC4"/>';
    }

    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">' +
        '<rect width="200" height="200" fill="' + bg + '"/>' +
        '<path d="M30 38l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="#fff" opacity=".7"/>' +
        '<path d="M168 150l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#fff" opacity=".6"/>' +
        back + accBack +
        '<path d="M26 206C26 168 62 154 100 154s74 14 74 52z" fill="' + shirt + '"/>' +
        '<path d="M82 155Q100 182 118 155z" fill="' + skin + '"/>' +
        '<rect x="88" y="130" width="24" height="30" rx="8" fill="' + skin + '"/>' +
        '<path d="M88 146Q100 156 112 146V132H88z" fill="#000" opacity=".1"/>' +
        '<circle cx="56" cy="100" r="7" fill="' + skin + '"/><circle cx="144" cy="100" r="7" fill="' + skin + '"/>' +
        '<ellipse cx="100" cy="96" rx="44" ry="48" fill="' + skin + '"/>' +
        '<ellipse cx="68" cy="112" rx="9" ry="5.5" fill="#FF8FB1" opacity=".38"/><ellipse cx="132" cy="112" rx="9" ry="5.5" fill="#FF8FB1" opacity=".38"/>' +
        eyes + mouth + front + accFront +
        '</svg>';
}

function avBlob(cfg) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const c = document.createElement("canvas");
            c.width = c.height = 512;
            c.getContext("2d").drawImage(img, 0, 0, 512, 512);
            c.toBlob(b => b ? resolve(b) : reject(new Error("Could not render the avatar")), "image/jpeg", 0.92);
        };
        img.onerror = () => reject(new Error("Could not render the avatar"));
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(avSvg(cfg));
    });
}

function openAvatarMaker() {
    if (!myProfile || !authUser) return;
    let cfg = Object.assign({}, AV_DEFAULT);
    try { Object.assign(cfg, JSON.parse(localStorage.getItem("avatarCfg") || "{}")); } catch (e) {}
    cfg = avClamp(cfg);

    const page = openSubPage("avatarPage", "Make your avatar");
    const useBtn = gBtn("Use", "sp-save", save);
    page.querySelector(".sp-gap").replaceWith(useBtn);
    const body = page.querySelector(".sp-body");

    const prev = gEl("div", "p3-avprev");
    const tools = gEl("div", "pe-btns");
    tools.style.justifyContent = "center";
    tools.appendChild(gBtn("Randomize", "pe-btn", () => {
        Object.keys(AV_LIMITS).forEach(k => { cfg[k] = Math.floor(Math.random() * AV_LIMITS[k]); });
        draw();
    }));
    body.append(prev, tools);

    const groups = {};
    function addGroup(label, key, labels, colors) {
        const sec = gEl("div", "pe-section");
        sec.appendChild(gEl("div", "pe-label", label));
        const row = gEl("div", "p3-row");
        const btns = [];
        (colors || labels).forEach((v, i) => {
            const b = gEl("button", colors ? "p3-sw" : "p3-chip", colors ? "" : v);
            b.type = "button";
            if (colors) b.style.background = v;
            b.addEventListener("click", () => { cfg[key] = i; draw(); });
            btns.push(b);
            row.appendChild(b);
        });
        groups[key] = btns;
        sec.appendChild(row);
        body.appendChild(sec);
    }
    addGroup("Skin", "skin", null, AV.skin);
    addGroup("Hair style", "style", AV.styles);
    addGroup("Hair colour", "hair", null, AV.hair);
    addGroup("Eyes", "eyes", AV.eyes);
    addGroup("Mouth", "mouth", AV.mouth);
    addGroup("Accessory", "acc", AV.acc);
    addGroup("Outfit", "shirt", null, AV.shirt);
    addGroup("Background", "bg", null, AV.bg);

    function draw() {
        prev.innerHTML = avSvg(cfg);
        Object.keys(groups).forEach(k => groups[k].forEach((b, i) => b.classList.toggle("on", i === cfg[k])));
    }
    draw();

    async function save() {
        useBtn.disabled = true;
        useBtn.textContent = "Saving...";
        try {
            const blob = await avBlob(cfg);
            const path = authUser.id + "/avatar-" + crypto.randomUUID() + ".jpg";
            const up = await supabaseClient.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg" });
            if (up.error) throw up.error;
            const url = supabaseClient.storage.from("avatars").getPublicUrl(path).data.publicUrl;
            const r = await supabaseClient.from("profiles").update({ avatar_url: url }).eq("id", authUser.id);
            if (r.error) throw r.error;
            try { localStorage.setItem("avatarCfg", JSON.stringify(cfg)); } catch (e) {}
            await loadProfile();
            renderProfile();
            const pe = document.querySelector("#editPage .pe-av");
            if (pe) paintAvatar(pe, url, myProfile.username);
            page.remove();
            gToast("Avatar updated");
        } catch (e) {
            console.error(e);
            alert("Could not save the avatar: " + (e.message || e));
            useBtn.disabled = false;
            useBtn.textContent = "Use";
        }
    }
}

// ---------- hooks (guarded, so a missing earlier block can never break the app) ----------
if (typeof pxBuild === "function") {
    const _pxBuild4 = pxBuild;
    pxBuild = async function (ctx) {
        await _pxBuild4(ctx);
        try { await p3Extend(ctx); } catch (e) { console.error(e); }
    };
}

if (typeof openEditProfilePage === "function") {
    const _openEdit4 = openEditProfilePage;
    openEditProfilePage = async function () {
        await _openEdit4.apply(this, arguments);
        try {
            const row = document.querySelector("#editPage .pe-avrow");
            if (row && !row.querySelector(".p3-avbtn")) row.append(gBtn("Make an avatar", "pe-btn p3-avbtn", openAvatarMaker));
        } catch (e) { console.error(e); }
    };
}

// Truth or Dare: count a turn when the player presses Done
if (typeof gFinish === "function") {
    const _gFinish3 = gFinish;
    gFinish = async function (answer) {
        try {
            const s = G.state;
            if (s && s.status === "playing" && s.phase === "prompt" && myProfile && s.turn === myProfile.username && G.room) {
                statLog("tod", s.choice === "dare" ? "dare" : "truth", G.room.id + ":tod:" + s.round + ":" + s.turn);
            }
        } catch (e) { console.error(e); }
        return _gFinish3(answer);
    };
}

// Hot Seat: count a turn when I am put in the Hot Seat
if (typeof hsApply === "function") {
    const _hsApply4 = hsApply;
    hsApply = function (row, force) {
        _hsApply4(row, force);
        try {
            const s = HS.state;
            if (s && s.status === "playing" && s.phase === "asking" && myProfile && s.seat === myProfile.username) {
                statLog("hot", "seat", HS.key + ":" + s.round + ":" + s.endsAt);
            }
        } catch (e) { console.error(e); }
    };
}
// ================================
// SOCIAL v5: home feed, stories (camera/video, likes, replies), post likes/comments,
// notifications, chat notes row, highlight + banner fixes
// Paste at the very end of auth.js (below PROFILE v4).
// ================================
const IX = {
    heart: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1.2-4.4A8 8 0 1 1 21 12z"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 7H4c0-1 2-2 2-7z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
    home: '<svg viewBox="0 0 24 24"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/></svg>',
    arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
};

// ---------- 1. Fixes: reliable delete, highlights, banner ----------

// Deleting now goes through a server function that confirms a row was really removed
async function pxDel(table, id) {
    const kinds = {
        profile_stories: "story", profile_posts: "post",
        profile_highlights: "highlight", profile_highlight_items: "highlight_item"
    };
    const { data, error } = await supabaseClient.rpc("px_delete", { p_kind: kinds[table], p_id: id });
    if (error) throw error;
    if (!data) throw new Error("Nothing was deleted");
}

// Opening a highlight: deleting its last photo now removes the highlight itself, and empty ones can be deleted
async function pxOpenHighlight(hl, ctx, owner) {
    const { data, error } = await supabaseClient.rpc("px_highlight_items", { p_highlight: hl.id });
    if (error) { console.error(error); gToast("Could not open this highlight"); return; }
    const rows = data || [];
    if (!rows.length) {
        if (!ctx.self) { gToast("Nothing in this highlight yet"); return; }
        if (confirm("This highlight is empty. Delete it?")) {
            try { await pxDel("profile_highlights", hl.id); gToast("Highlight deleted"); pxBuild(ctx); }
            catch (e) { console.error(e); gToast("Could not delete it"); }
        }
        return;
    }
    let left = rows.length;
    pxViewer({
        items: rows, auto: true,
        name: owner.name, avatarBg: owner.avatarBg, initial: owner.initial,
        canDelete: ctx.self,
        onDelete: async it => {
            await pxDel("profile_highlight_items", it.id);
            left--;
            if (left <= 0) await pxDel("profile_highlights", hl.id);
        },
        actions: ctx.self ? [{
            label: "Delete highlight",
            fn: async (it, c) => {
                if (!confirm("Delete the whole highlight?")) return;
                try { await pxDel("profile_highlights", hl.id); c.close(); }
                catch (e) { console.error(e); gToast("Could not delete it"); }
            }
        }] : [],
        onClose: () => { if (ctx.self) pxBuild(ctx); }
    });
}

// Banner: remember what the server says and hide the banner when the owner removed it
const PTB = { last: {} };
const _ptFetch5 = ptFetch;
ptFetch = async function (u) {
    const ex = await _ptFetch5(u);
    PTB.last[String(u || "").toLowerCase()] = ex;
    return ex;
};
function ptBannerFix(username) {
    const ex = PTB.last[String(username || "").toLowerCase()];
    if (!ex || ex.show_banner !== false) return;
    document.querySelectorAll("#pfBannerBox, #upBanner").forEach(e => e.remove());
}
const _ptRenderMe5 = ptRenderMe;
ptRenderMe = async function () {
    await _ptRenderMe5();
    try { ptBannerFix(myProfile && myProfile.username); } catch (e) { console.error(e); }
};
const _ptEnhance5 = ptEnhanceUserPage;
ptEnhanceUserPage = async function (u) {
    await _ptEnhance5(u);
    try { ptBannerFix(u); } catch (e) { console.error(e); }
};

// Edit profile page: "Remove banner" now really removes it (and picking a new one brings it back)
const _openEdit5 = openEditProfilePage;
openEditProfilePage = async function () {
    await _openEdit5.apply(this, arguments);
    try {
        const page = $("editPage");
        if (!page) return;
        const banner = page.querySelector(".pt-banner");
        const btns = Array.from(page.querySelectorAll(".pe-btn"));
        const rm = btns.find(b => /remove banner/i.test(b.textContent));
        const fileIn = page.querySelector('.pe-btns input[type="file"]');
        const ex = await ptFetch(myProfile.username);
        if (banner && ex && ex.show_banner === false) banner.style.display = "none";
        if (rm) rm.addEventListener("click", async () => {
            const { error } = await supabaseClient.rpc("set_banner_visible", { p_visible: false });
            if (error) { console.error(error); gToast("Could not remove the banner"); return; }
            if (banner) banner.style.display = "none";
            gToast("Banner removed");
        });
        if (fileIn && fileIn.parentElement) {
            // Capture phase: runs before the original handler clears the file input
            fileIn.parentElement.addEventListener("change", async () => {
                if (fileIn.files && fileIn.files[0]) {
                    await supabaseClient.rpc("set_banner_visible", { p_visible: true });
                    if (banner) banner.style.display = "";
                }
            }, true);
        }
    } catch (e) { console.error(e); }
};

// ---------- 2. Sending a reply into a DM (story replies, note replies) ----------
async function ixDmReply(username, name, quote, text) {
    const { data, error } = await supabaseClient.rpc("start_dm", { p_username: username }).single();
    if (error || !data) throw error || new Error("Could not open the chat");
    const { error: e2 } = await supabaseClient.from("messages").insert({
        room_id: data.id,
        username: myProfile.username,
        message: text,
        reply_to: { id: "x:" + Date.now(), name: name, text: quote }
    });
    if (e2) throw e2;
}

// ---------- 3. Story / post composer (full screen, camera or gallery) ----------
function ixPick(mode, allowVideo) {
    return new Promise(resolve => {
        const f = document.createElement("input");
        f.type = "file";
        f.accept = mode === "video" ? "video/*" : mode === "photo" ? "image/*" : (allowVideo ? "image/*,video/*" : "image/*");
        if (mode === "photo" || mode === "video") f.setAttribute("capture", "environment");
        f.style.display = "none";
        f.addEventListener("change", () => { const x = f.files && f.files[0]; f.remove(); resolve(x || null); });
        f.addEventListener("cancel", () => { f.remove(); resolve(null); });
        document.body.appendChild(f);
        f.click();
    });
}

async function ixUploadFile(file, kind) {
    const ext = ((file.type || "video/mp4").split("/")[1] || "mp4").split(";")[0].replace("quicktime", "mov");
    const path = authUser.id + "/" + kind + "-" + crypto.randomUUID() + "." + ext;
    const { error } = await supabaseClient.storage.from("avatars").upload(path, file, { contentType: file.type || "video/mp4" });
    if (error) throw error;
    return supabaseClient.storage.from("avatars").getPublicUrl(path).data.publicUrl;
}

async function pxCompose(kind, done) {
    const isStory = kind !== "post";
    const pick = async mode => {
        const f = await ixPick(mode, isStory);
        if (f) ixComposer(kind, f, done);
    };
    const items = [["Take a photo", () => pick("photo")]];
    if (isStory) items.push(["Record a video", () => pick("video")]);
    items.push(["Choose from gallery", () => pick("gallery")], ["Cancel", () => {}]);
    showSheet(items, isStory ? "New story" : "New post");
}

function ixComposer(kind, file, done) {
    const isStory = kind !== "post";
    const isVideo = /^video\//.test(file.type || "");
    if (isVideo && file.size > 45 * 1024 * 1024) { alert("This video is too big. Please pick one under 45 MB."); return; }

    const url = URL.createObjectURL(file);
    const root = gEl("div", "ix-comp");
    const close = () => { URL.revokeObjectURL(url); root.remove(); };

    const top = gEl("div", "ix-top");
    top.append(gBtn("×", "ix-x", close), gEl("span", "ix-title", isStory ? "New story" : "New post"));

    const stage = gEl("div", "ix-stage");
    let media;
    if (isVideo) {
        media = document.createElement("video");
        media.src = url;
        media.muted = true;
        media.loop = true;
        media.autoplay = true;
        media.playsInline = true;
        media.setAttribute("playsinline", "");
        media.addEventListener("loadedmetadata", () => {
            if (media.duration > 60.5) { alert("Videos can be up to 60 seconds."); close(); }
        });
        media.play().catch(() => {});
    } else {
        media = new Image();
        media.src = url;
    }
    media.className = "ix-media";
    stage.appendChild(media);

    const cap = gEl("input", "ix-cap");
    cap.placeholder = "Add a caption...";
    cap.maxLength = isStory ? 120 : 200;

    const bar = gEl("div", "ix-bar");
    const me = gEl("div", "ix-me");
    paintAvatar(me, myProfile.avatar_url, myProfile.display_name || myProfile.username);
    const label = gEl("span", "", isStory ? "Your story" : "Share post");
    const arrow = gEl("span", "ix-arrow");
    arrow.innerHTML = IX.arrow;
    const share = gEl("button", "ix-share");
    share.type = "button";
    share.append(me, label, arrow);
    bar.append(share, gEl("p", "ix-note", isStory ? "Visible to your friends for 24 hours" : "Visible to your friends"));

    share.addEventListener("click", async () => {
        share.disabled = true;
        label.textContent = "Sharing...";
        try {
            let mediaUrl;
            if (isVideo) mediaUrl = await ixUploadFile(file, "story");
            else {
                const blob = await pxResize(file, isStory ? 1080 : 1440, 0.85);
                if (!blob) throw new Error("Could not read that image");
                mediaUrl = await pxUpload(blob, isStory ? "story" : "post");
            }
            const row = { user_id: authUser.id, media_url: mediaUrl, caption: cap.value.trim() || null };
            if (isStory) row.media_type = isVideo ? "video" : "image";
            const { error } = await supabaseClient.from(isStory ? "profile_stories" : "profile_posts").insert(row);
            if (error) throw error;
            close();
            gToast(isStory ? "Story shared for 24 hours" : "Post shared");
            if (done) done();
        } catch (e) {
            console.error(e);
            alert("Could not share: " + (e.message || e));
            share.disabled = false;
            label.textContent = isStory ? "Your story" : "Share post";
        }
    });

    root.append(top, stage, cap, bar);
    document.body.appendChild(root);
}

// ---------- 4. Story viewer (likes, replies, next person) ----------
// groups: [{ username, name, avatar | avatarBg, initial, self, items: [{ id, media_url, media_type, caption, created_at }] }]
function stViewer(groups, start, onClose) {
    if (!groups || !groups.length) return;
    let gi = Math.min(Math.max(start || 0, 0), groups.length - 1);
    let ii = 0, timer = null, vid = null, changed = false;

    const root = gEl("div", "st-viewer");
    const bars = gEl("div", "st-bars");
    const head = gEl("div", "st-head");
    const av = gEl("div", "st-av");
    const who = gEl("div", "st-who");
    const nm = gEl("strong");
    const wh = gEl("span");
    who.append(nm, wh);
    head.append(av, who, gBtn("×", "st-x", closeV));
    const stage = gEl("div", "st-stage");
    const cap = gEl("div", "st-cap");
    const foot = gEl("div", "st-foot");
    const zl = gEl("div", "st-zone l");
    const zr = gEl("div", "st-zone r");
    zl.addEventListener("click", prev);
    zr.addEventListener("click", next);
    root.append(bars, head, stage, cap, foot, zl, zr);
    document.body.appendChild(root);
    show(gi, 0);

    function stopMedia() {
        clearTimeout(timer);
        timer = null;
        if (vid) { try { vid.pause(); } catch (e) {} vid = null; }
    }
    function closeV() {
        stopMedia();
        root.remove();
        if (onClose) onClose(changed);
    }
    function next() {
        const g = groups[gi];
        if (ii + 1 < g.items.length) show(gi, ii + 1);
        else if (gi + 1 < groups.length) show(gi + 1, 0);
        else closeV();
    }
    function prev() {
        if (ii > 0) show(gi, ii - 1);
        else if (gi > 0) show(gi - 1, 0);
        else show(gi, 0);
    }
    function pause() {
        clearTimeout(timer);
        timer = null;
        root.classList.add("paused");
        if (vid) vid.pause();
    }
    function resume() { show(gi, ii, true); }

    function show(g2, i2, keepFoot) {
        stopMedia();
        root.classList.remove("paused");
        gi = g2;
        ii = i2;
        const g = groups[gi];
        const it = g.items[ii];

        if (g.avatarBg) { av.style.backgroundImage = g.avatarBg; av.textContent = ""; }
        else paintAvatar(av, g.avatar, g.name);
        nm.textContent = g.self ? "Your story" : g.name;
        wh.textContent = timeAgo(it.created_at);

        bars.innerHTML = "";
        g.items.forEach((_, k) => {
            const b = document.createElement("i");
            if (k < ii) b.className = "done";
            bars.appendChild(b);
        });
        const cur = bars.children[ii];

        stage.innerHTML = "";
        const src = ptSafeUrl(it.media_url);
        if (it.media_type === "video") {
            const v = document.createElement("video");
            v.className = "st-media";
            v.src = src;
            v.playsInline = true;
            v.setAttribute("playsinline", "");
            v.autoplay = true;
            v.addEventListener("loadedmetadata", () => {
                const d = Math.min(Math.max(v.duration || 5, 1), 60);
                cur.style.setProperty("--dur", d + "s");
                cur.className = "now";
            });
            v.addEventListener("ended", next);
            v.addEventListener("error", () => { timer = setTimeout(next, 1500); });
            v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
            stage.appendChild(v);
            vid = v;
        } else {
            const im = document.createElement("img");
            im.className = "st-media";
            im.src = src;
            stage.appendChild(im);
            cur.style.setProperty("--dur", "5s");
            cur.className = "now";
            timer = setTimeout(next, 5000);
        }

        cap.textContent = it.caption || "";
        cap.style.display = it.caption ? "" : "none";
        if (!keepFoot) buildFoot(g, it);
    }

    function buildFoot(g, it) {
        foot.innerHTML = "";
        const heart = gEl("button", "st-heart");
        heart.type = "button";
        heart.innerHTML = IX.heart;
        const cnt = gEl("span", "st-cnt", "");
        heart.appendChild(cnt);
        const setHeart = (liked, n) => {
            heart.classList.toggle("on", !!liked);
            cnt.textContent = g.self && n ? String(n) : "";
        };
        supabaseClient.rpc("story_state", { p_story: it.id }).then(({ data }) => {
            const r = data && data[0];
            if (r && groups[gi] === g && g.items[ii] === it) setHeart(r.liked, Number(r.likes));
        });
        heart.addEventListener("click", async () => {
            const { data, error } = await supabaseClient.rpc("story_like", { p_story: it.id });
            if (error) { console.error(error); gToast("Could not like this story"); return; }
            const r = data && data[0];
            if (r) setHeart(r.liked, Number(r.likes));
        });

        if (g.self) {
            const del = async () => {
                if (!confirm("Delete this story?")) return;
                pause();
                try { await pxDel("profile_stories", it.id); }
                catch (e) { console.error(e); gToast("Could not delete it"); resume(); return; }
                changed = true;
                g.items.splice(ii, 1);
                if (!g.items.length) {
                    groups.splice(gi, 1);
                    if (!groups.length) { closeV(); return; }
                    if (gi >= groups.length) gi = groups.length - 1;
                    show(gi, 0);
                } else show(gi, Math.min(ii, g.items.length - 1));
            };
            foot.append(
                heart,
                gBtn("Add to highlight", "st-btn", () => {
                    if (it.media_type === "video") { gToast("Video stories can't be added to highlights yet"); return; }
                    pause();
                    pxToHighlight(it);
                }),
                gBtn("Delete", "st-btn danger", del)
            );
        } else {
            const form = gEl("form", "st-reply");
            const inp = gEl("input");
            inp.placeholder = "Send message...";
            inp.maxLength = 200;
            inp.addEventListener("focus", pause);
            inp.addEventListener("blur", resume);
            form.appendChild(inp);
            form.addEventListener("submit", async e => {
                e.preventDefault();
                const t = inp.value.trim();
                if (!t) return;
                inp.disabled = true;
                try {
                    await ixDmReply(g.username, g.name, "Story", t);
                    inp.value = "";
                    gToast("Reply sent");
                    inp.disabled = false;
                    inp.blur();
                } catch (err) {
                    console.error(err);
                    gToast("Could not send the reply");
                    inp.disabled = false;
                }
            });
            foot.append(form, heart);
        }
    }
}

// Profile story ring now opens the new viewer
function pxViewStories(x) {
    const { d, ctx, owner } = x;
    const g = {
        username: ctx.username, name: owner.name, avatarBg: owner.avatarBg, initial: owner.initial, self: ctx.self,
        items: d.stories.map(s => ({
            id: s.id, media_url: s.media_url, media_type: s.media_type || "image",
            caption: s.caption, created_at: s.created_at
        }))
    };
    stViewer([g], 0, () => { if (ctx.self) pxBuild(ctx); });
}

// ---------- 5. Posts: card with like and comments ----------
function fdPostCard(p, opt) {
    opt = opt || {};
    const card = gEl("div", "fd-post");

    const top = gEl("div", "fd-ptop");
    const av = gEl("div", "fd-av");
    paintAvatar(av, p.avatar_url, p.name);
    const who = gEl("div", "fd-who");
    who.append(gEl("strong", "", p.name), gEl("span", "", timeAgo(p.created_at)));
    [av, who].forEach(e => e.addEventListener("click", () => openUserProfile(p.username)));
    top.append(av, who);
    if (p.mine) {
        top.append(gBtn("⋯", "fd-more", () => showSheet([
            ["Delete post", async () => {
                if (!confirm("Delete this post?")) return;
                try { await pxDel("profile_posts", p.id); }
                catch (e) { console.error(e); gToast("Could not delete it"); return; }
                card.remove();
                if (opt.onDelete) opt.onDelete();
            }, true],
            ["Cancel", () => {}]
        ])));
    }

    const wrap = gEl("div", "fd-imgwrap");
    const img = gEl("img", "fd-img");
    img.src = ptSafeUrl(p.media_url);
    img.alt = "";
    img.loading = "lazy";
    const pop = gEl("div", "fd-pop");
    pop.innerHTML = IX.heart;
    wrap.append(img, pop);

    const acts = gEl("div", "fd-acts");
    const likeBtn = gEl("button", "fd-act" + (p.liked ? " on" : ""));
    likeBtn.type = "button";
    likeBtn.innerHTML = IX.heart;
    const lc = gEl("span", "", String(p.likes));
    likeBtn.appendChild(lc);
    likeBtn.addEventListener("click", async () => {
        const { data, error } = await supabaseClient.rpc("post_like", { p_post: p.id });
        if (error) { console.error(error); gToast("Could not update the like"); return; }
        const r = data && data[0];
        if (!r) return;
        likeBtn.classList.toggle("on", !!r.liked);
        lc.textContent = String(r.likes);
    });
    let lastTap = 0;
    img.addEventListener("click", () => {
        const now = Date.now();
        if (now - lastTap < 320) {
            lastTap = 0;
            pop.classList.remove("go");
            void pop.offsetWidth;
            pop.classList.add("go");
            if (!likeBtn.classList.contains("on")) likeBtn.click();
        } else lastTap = now;
    });

    const cmBtn = gEl("button", "fd-act");
    cmBtn.type = "button";
    cmBtn.innerHTML = IX.chat;
    const cc = gEl("span", "", String(p.comments));
    cmBtn.appendChild(cc);
    acts.append(likeBtn, cmBtn);

    const cap = gEl("div", "fd-cap");
    if (p.caption) { cap.append(gEl("b", "", p.name + " "), document.createTextNode(p.caption)); }
    else cap.style.display = "none";

    const thread = gEl("div", "fd-thread");
    thread.style.display = "none";
    async function loadThread() {
        const { data, error } = await supabaseClient.rpc("post_comments", { p_post: p.id });
        thread.innerHTML = "";
        if (error) { console.error(error); thread.appendChild(gEl("p", "empty", "Could not load comments.")); return; }
        const rows = data || [];
        cc.textContent = String(rows.length);
        rows.forEach(c => {
            const row = gEl("div", "fd-cm");
            const a = gEl("div", "fd-av small");
            paintAvatar(a, c.author_avatar, c.author_name);
            a.addEventListener("click", () => openUserProfile(c.author));
            const b = gEl("div", "fd-cm-body");
            b.append(gEl("strong", "", c.author_name), gEl("span", "", c.body));
            row.append(a, b);
            if (c.can_delete) {
                row.append(gBtn("×", "fd-x", async () => {
                    const { error: e2 } = await supabaseClient.rpc("post_comment_delete", { p_comment: c.id });
                    if (e2) { console.error(e2); gToast("Could not delete"); return; }
                    loadThread();
                }));
            }
            thread.appendChild(row);
        });
        const f = gEl("form", "fd-cform");
        const i = gEl("input");
        i.placeholder = "Add a comment...";
        i.maxLength = 200;
        const s = gEl("button", "", "Post");
        s.type = "submit";
        f.append(i, s);
        f.addEventListener("submit", async e => {
            e.preventDefault();
            const t = i.value.trim();
            if (!t) return;
            s.disabled = true;
            const { error: e3 } = await supabaseClient.rpc("post_comment", { p_post: p.id, p_body: t });
            s.disabled = false;
            if (e3) { console.error(e3); gToast(e3.message || "Could not comment"); return; }
            loadThread();
        });
        thread.appendChild(f);
    }
    cmBtn.addEventListener("click", () => {
        const open = thread.style.display === "none";
        thread.style.display = open ? "" : "none";
        if (open) loadThread();
    });

    card.append(top, wrap, acts, cap, thread);
    return card;
}

async function openPostPage(id, onClose) {
    const { data, error } = await supabaseClient.rpc("post_one", { p_post: id });
    const p = data && data[0];
    if (error || !p) { gToast("This post is not available any more"); return; }
    const page = openSubPage("postPage", "Post", onClose);
    page.querySelector(".sp-body").appendChild(fdPostCard(p, {
        onDelete: () => { page.remove(); if (onClose) onClose(); }
    }));
}

// Tapping a post in a profile grid opens the post page (with likes and comments)
const _pxViewer5 = pxViewer;
pxViewer = function (o) {
    if (o && o.auto === false && o.items && o.items.length) {
        openPostPage(o.items[o.start || 0].id, o.onClose);
        return;
    }
    return _pxViewer5(o);
};

// ---------- 6. Home feed page ----------
const FD = { before: null, loading: false, done: false, groups: [], built: false };

function fdBuild() {
    if (FD.built || $("feedPage")) return;
    FD.built = true;
    const p = document.createElement("main");
    p.id = "feedPage";
    p.className = "page top hidden";
    p.innerHTML =
        '<div class="fd-wrap">' +
            '<header class="fd-top"><strong>Home</strong><div class="fd-btns">' +
                '<button type="button" id="fdAdd" class="hdr-btn" title="New post">' + IX.plus + '</button>' +
                '<button type="button" id="fdBell" class="hdr-btn" title="Notifications">' + IX.bell +
                    '<span id="fdBadge" class="bell-badge hidden"></span></button>' +
            '</div></header>' +
            '<div id="fdStories" class="fd-stories"></div>' +
            '<div id="fdPosts"></div>' +
            '<p id="fdMore" class="empty"></p>' +
        '</div>';
    document.body.appendChild(p);
    $("fdAdd").addEventListener("click", () => pxCompose("post", () => fdLoadPosts(true)));
    $("fdBell").addEventListener("click", () => openNotifications());
}

function fdNav() {
    const nav = $("bottomNav");
    if (!nav || $("navHome")) return;
    const b = document.createElement("button");
    b.type = "button";
    b.id = "navHome";
    b.className = "nav-btn";
    b.dataset.tab = "feedPage";
    b.dataset.key = "home";
    b.innerHTML = IX.home + "<span>Home</span>";
    b.addEventListener("click", () => showPage("feedPage"));
    nav.prepend(b);
}

function fdReload() { fdLoadStories(); fdLoadPosts(true); }

async function fdLoadStories() {
    const box = $("fdStories");
    if (!box || !myProfile) return;
    const { data, error } = await supabaseClient.rpc("feed_stories");
    if (error) { console.error(error); return; }
    const map = {};
    const groups = [];
    (data || []).forEach(s => {
        let g = map[s.username];
        if (!g) {
            g = map[s.username] = {
                username: s.username, name: s.name, avatar: s.avatar_url,
                self: s.username === myProfile.username, items: []
            };
            groups.push(g);
        }
        g.items.push({ id: s.id, media_url: s.media_url, media_type: s.media_type, caption: s.caption, created_at: s.created_at });
    });
    const last = g => new Date(g.items[g.items.length - 1].created_at).getTime();
    const mine = groups.find(g => g.self) || null;
    const others = groups.filter(g => !g.self).sort((a, b) => last(b) - last(a));
    const list = (mine ? [mine] : []).concat(others);
    FD.groups = list;

    box.innerHTML = "";
    const addItem = (g, isMe) => {
        const it = gEl("div", "fd-st");
        const av = gEl("div", "fd-stav" + (g && g.items.length ? " ring" : ""));
        paintAvatar(av, isMe ? myProfile.avatar_url : g.avatar, isMe ? (myProfile.display_name || myProfile.username) : g.name);
        if (isMe) {
            av.appendChild(gBtn("", "fd-plus", e => { e.stopPropagation(); pxCompose("story", fdReload); }));
            av.lastChild.innerHTML = IX.plus;
        }
        it.append(av, gEl("span", "nm", isMe ? "Your story" : g.name));
        it.addEventListener("click", () => {
            if (isMe && !g) { pxCompose("story", fdReload); return; }
            stViewer(list, list.indexOf(g), fdLoadStories);
        });
        box.appendChild(it);
    };
    addItem(mine, true);
    others.forEach(g => addItem(g, false));
}

async function fdLoadPosts(reset) {
    const box = $("fdPosts");
    if (!box || !myProfile) return;
    if (reset) { FD.before = null; FD.done = false; box.innerHTML = ""; }
    if (FD.loading || FD.done) return;
    FD.loading = true;
    const { data, error } = await supabaseClient.rpc("feed_posts", { p_before: FD.before, p_limit: 8 });
    FD.loading = false;
    if (error) { console.error(error); $("fdMore").textContent = "Could not load posts."; return; }
    const rows = data || [];
    rows.forEach(p => box.appendChild(fdPostCard(p)));
    if (rows.length) FD.before = rows[rows.length - 1].created_at;
    if (rows.length < 8) FD.done = true;
    $("fdMore").textContent = box.children.length ? "" : "No posts yet. Posts from you and your friends will show up here.";
}

window.addEventListener("scroll", () => {
    const pg = $("feedPage");
    if (!pg || pg.classList.contains("hidden") || FD.loading || FD.done) return;
    const el = document.documentElement;
    if (window.innerHeight + window.scrollY > el.scrollHeight - 700) fdLoadPosts(false);
}, { passive: true });

const _showPage5 = window.showPage;
window.showPage = function (id) {
    _showPage5(id);
    const h = $("navHome");
    if (id === "feedPage") {
        if (h) h.classList.add("active");
        try { fdReload(); } catch (e) { console.error(e); }
    } else if (h) h.classList.remove("active");
};

// Second bell on the feed shows the same unread count
const _refreshBell5 = refreshBell;
refreshBell = async function () {
    await _refreshBell5();
    const b = $("bellBadge");
    const f = $("fdBadge");
    if (b && f) {
        f.textContent = b.textContent;
        f.classList.toggle("hidden", b.classList.contains("hidden"));
    }
};

// ---------- 7. Notifications page: likes and comments included ----------
async function openNotifications() {
    const page = openSubPage("notifPage", "Notifications", () => refreshBell());
    const box = page.querySelector(".sp-body");
    box.innerHTML = '<p class="empty">Loading...</p>';

    const { data, error } = await supabaseClient.rpc("my_notifications");
    box.innerHTML = "";
    if (error) {
        console.error(error);
        box.innerHTML = '<p class="empty">Could not load notifications.</p>';
        return;
    }
    const list = data || [];
    if (!list.length) box.innerHTML = '<p class="empty">No notifications yet.</p>';

    const texts = {
        friend_request: "sent you a friend request",
        friend_accepted: "accepted your friend request",
        dm_request: "sent you a message request",
        dm_accepted: "accepted your message request",
        post_like: "liked your post",
        post_comment: "commented on your post",
        story_like: "liked your story"
    };

    list.forEach(n => {
        const row = document.createElement("div");
        row.className = "member-row notif-row" + (n.is_read ? "" : " unread");
        row.style.cursor = "pointer";

        const av = document.createElement("div");
        av.className = "member-av";
        paintAvatar(av, n.avatar_url, n.display_name || n.username);

        const txt = document.createElement("div");
        txt.className = "member-text";
        const name = document.createElement("strong");
        name.textContent = n.display_name || n.username || "Someone";
        const sub = document.createElement("span");
        sub.textContent = (texts[n.kind] || "") + " · " + timeAgo(n.created_at);
        txt.append(name, sub);
        row.append(av, txt);

        row.addEventListener("click", async () => {
            page.remove();
            if (n.kind === "dm_request") openRequests();
            else if (n.kind === "dm_accepted") {
                const { data: rs } = await supabaseClient.rpc("my_rooms");
                const room = (rs || []).find(r => String(r.id) === String(n.room_id));
                if (room) {
                    currentRoom = room;
                    currentUser = myProfile.username;
                    await loadDmMap();
                    openChat();
                }
            } else if (n.kind === "post_like" || n.kind === "post_comment") openPostPage(n.room_id, () => refreshBell());
            else if (n.kind === "story_like") showPage("profilePage");
            else if (n.username) openUserProfile(n.username);
        });
        box.appendChild(row);
    });

    await supabaseClient.rpc("mark_notifs_read");
    refreshBell();
}

// ---------- 8. Notes row at the top of the Chats list ----------
function cnItem(o) {
    const it = gEl("div", "cn-item");
    if (o.note) {
        const c = PX_NOTE[pxIdx(o.note.color)];
        const b = gEl("div", "cn-bubble", o.note.body);
        b.style.background = c.bg;
        b.style.color = c.fg;
        it.appendChild(b);
    } else if (o.self) {
        it.appendChild(gEl("div", "cn-bubble ghost", "Note..."));
    }
    const av = gEl("div", "cn-av");
    paintAvatar(av, o.avatar, o.name);
    it.append(av, gEl("span", "cn-name", o.self ? "Your note" : o.name));
    it.addEventListener("click", () => {
        if (o.self) { pxNoteEditor(o.note, cnRender); return; }
        showSheet([
            ["Reply to note", async () => {
                const t = await pxAsk("Reply to " + o.name, "Reply...", 200);
                if (!t) return;
                try { await ixDmReply(o.username, o.name, "Note: " + o.note.body, t); gToast("Reply sent"); }
                catch (e) { console.error(e); gToast("Could not send the reply"); }
            }],
            ["View profile", () => openUserProfile(o.username)],
            ["Cancel", () => {}]
        ], o.name);
    });
    return it;
}

async function cnRender() {
    const anchor = $("newDmBtn");
    if (!anchor || !myProfile) return;
    let row = $("chatNotes");
    if (!row) {
        row = gEl("div", "cn-row");
        row.id = "chatNotes";
        anchor.before(row);
    }
    const { data, error } = await supabaseClient.rpc("friend_notes");
    if (error) { console.error(error); return; }
    const list = data || [];
    const me = myProfile.username;
    const mine = list.find(n => n.username === me) || null;
    row.innerHTML = "";
    row.appendChild(cnItem({
        username: me, name: myProfile.display_name || me, avatar: myProfile.avatar_url,
        note: mine, self: true
    }));
    list.filter(n => n.username !== me).forEach(n => row.appendChild(cnItem({
        username: n.username, name: n.name, avatar: n.avatar_url, note: n, self: false
    })));
}

const _loadChats5 = loadChats;
loadChats = async function () {
    await _loadChats5();
    try { await cnRender(); } catch (e) { console.error(e); }
};
// ---------- start ----------
fdNav();
fdBuild();

// ================================
// SOCIAL v6 (part 2): in-app camera, Hot Seat in the voice room, avatar maker (girl/boy),
// nicknames + chat info page
// Paste at the very end of auth.js (below SOCIAL v5).
// ================================

// ---------- A. In-app camera (photo + video) and a safer composer ----------
function ixCamera(startMode, onFile, opts) {
    opts = opts || {};
    const canVideo = opts.video !== false && !!window.MediaRecorder;
    let mode = (startMode === "video" && canVideo) ? "video" : "photo";
    let facing = "environment";
    let stream = null, rec = null, chunks = [], timer = null, t0 = 0;

    const root = gEl("div", "cam");
    const v = document.createElement("video");
    v.className = "cam-v";
    v.autoplay = true;
    v.muted = true;
    v.playsInline = true;
    v.setAttribute("playsinline", "");

    const top = gEl("div", "cam-top");
    const tm = gEl("span", "cam-time");
    const flip = gBtn("", "cam-flip", () => { facing = facing === "user" ? "environment" : "user"; startStream(); });
    flip.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 9a8 8 0 0 1 14-3M20 15a8 8 0 0 1-14 3M18 3v4h-4M6 21v-4h4"/></svg>';
    top.append(gBtn("×", "cam-x", close), tm, flip);

    const bottom = gEl("div", "cam-bottom");
    const modes = gEl("div", "cam-modes");
    const bPhoto = gBtn("Photo", "cam-mode", () => setMode("photo"));
    const bVideo = gBtn("Video", "cam-mode", () => setMode("video"));
    modes.appendChild(bPhoto);
    if (canVideo) modes.appendChild(bVideo);
    const shutter = gEl("button", "cam-shutter");
    shutter.type = "button";
    shutter.setAttribute("aria-label", "Capture");
    shutter.addEventListener("click", () => { if (mode === "photo") snap(); else toggleRec(); });
    bottom.append(modes, shutter);
    root.append(v, top, bottom);

    function stopStream() {
        if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
        v.srcObject = null;
    }
    function close() {
        clearInterval(timer);
        if (rec) { try { rec.onstop = null; rec.stop(); } catch (e) {} rec = null; }
        stopStream();
        root.remove();
    }
    function camFail() {
        close();
        showSheet([
            ["Open the phone camera app", () => ixPick(mode === "video" ? "video" : "photo").then(f => { if (f) onFile(f); })],
            ["Choose from gallery", () => ixPick("gallery", canVideo).then(f => { if (f) onFile(f); })],
            ["Cancel", () => {}]
        ], "The camera could not open");
    }

    async function startStream() {
        stopStream();
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 1280 } },
                audio: mode === "video"
            });
        } catch (e) {
            console.error("camera", e);
            camFail();
            return;
        }
        if (!root.isConnected) { stopStream(); return; }   // closed while the permission prompt was open
        v.srcObject = stream;
        v.classList.toggle("mirror", facing === "user");
        v.play().catch(() => {});
    }

    function setMode(m) {
        if (rec || (m === "video" && !canVideo)) return;
        mode = m;
        bPhoto.classList.toggle("on", m === "photo");
        bVideo.classList.toggle("on", m === "video");
        root.classList.toggle("video", m === "video");
        startStream();
    }

    function snap() {
        if (!v.videoWidth) return;
        const s = Math.min(1, 1440 / Math.max(v.videoWidth, v.videoHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(v.videoWidth * s);
        c.height = Math.round(v.videoHeight * s);
        c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
        c.toBlob(b => {
            if (!b) { gToast("Could not take the photo"); return; }
            close();
            onFile(new File([b], "photo.jpg", { type: "image/jpeg" }));
        }, "image/jpeg", 0.9);
    }

    function pickMime() {
        const list = ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
        for (const m of list) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) {} }
        return "";
    }
    function toggleRec() {
        if (rec) { rec.stop(); return; }
        if (!stream) return;
        const mime = pickMime();
        try { rec = mime ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2500000 }) : new MediaRecorder(stream); }
        catch (e) { console.error(e); gToast("Could not start recording"); rec = null; return; }
        chunks = [];
        rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onstop = () => {
            clearInterval(timer);
            const type = ((rec && rec.mimeType) || mime || "video/webm").split(";")[0];
            const blob = new Blob(chunks, { type });
            rec = null;
            close();
            if (blob.size < 1000) { gToast("Nothing was recorded"); return; }
            onFile(new File([blob], "video." + (type.indexOf("mp4") >= 0 ? "mp4" : "webm"), { type }));
        };
        rec.start(1000);
        t0 = Date.now();
        root.classList.add("rec");
        timer = setInterval(() => {
            const s = Math.floor((Date.now() - t0) / 1000);
            tm.textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
            if (s >= 60 && rec) rec.stop();
        }, 250);
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { camFail(); return; }
    document.body.appendChild(root);
    setMode(mode);
}

async function pxCompose(kind, done) {
    const isStory = kind !== "post";
    const open = f => { if (f) ixComposer(kind, f, done); };
    const items = [["Take a photo", () => ixCamera("photo", open, { video: isStory })]];
    if (isStory) items.push(["Record a video", () => ixCamera("video", open, { video: true })]);
    items.push(["Choose from gallery", async () => open(await ixPick("gallery", isStory))], ["Cancel", () => {}]);
    showSheet(items, isStory ? "New story" : "New post");
}

// Same composer as before; a recorded video can report an unknown (infinite) duration, which is now handled
function ixComposer(kind, file, done) {
    const isStory = kind !== "post";
    const isVideo = /^video\//.test(file.type || "");
    if (isVideo && file.size > 45 * 1024 * 1024) { alert("This video is too big. Please pick one under 45 MB."); return; }

    const url = URL.createObjectURL(file);
    const root = gEl("div", "ix-comp");
    const close = () => { URL.revokeObjectURL(url); root.remove(); };

    const top = gEl("div", "ix-top");
    top.append(gBtn("×", "ix-x", close), gEl("span", "ix-title", isStory ? "New story" : "New post"));

    const stage = gEl("div", "ix-stage");
    let media;
    if (isVideo) {
        media = document.createElement("video");
        media.src = url;
        media.muted = true;
        media.loop = true;
        media.autoplay = true;
        media.playsInline = true;
        media.setAttribute("playsinline", "");
        media.addEventListener("loadedmetadata", () => {
            if (isFinite(media.duration) && media.duration > 60.5) { alert("Videos can be up to 60 seconds."); close(); }
        });
        media.play().catch(() => {});
    } else {
        media = new Image();
        media.src = url;
    }
    media.className = "ix-media";
    stage.appendChild(media);

    const cap = gEl("input", "ix-cap");
    cap.placeholder = "Add a caption...";
    cap.maxLength = isStory ? 120 : 200;

    const bar = gEl("div", "ix-bar");
    const me = gEl("div", "ix-me");
    paintAvatar(me, myProfile.avatar_url, myProfile.display_name || myProfile.username);
    const label = gEl("span", "", isStory ? "Your story" : "Share post");
    const arrow = gEl("span", "ix-arrow");
    arrow.innerHTML = IX.arrow;
    const share = gEl("button", "ix-share");
    share.type = "button";
    share.append(me, label, arrow);
    bar.append(share, gEl("p", "ix-note", isStory ? "Visible to your friends for 24 hours" : "Visible to your friends"));

    share.addEventListener("click", async () => {
        share.disabled = true;
        label.textContent = "Sharing...";
        try {
            let mediaUrl;
            if (isVideo) mediaUrl = await ixUploadFile(file, "story");
            else {
                const blob = await pxResize(file, isStory ? 1080 : 1440, 0.85);
                if (!blob) throw new Error("Could not read that image");
                mediaUrl = await pxUpload(blob, isStory ? "story" : "post");
            }
            const row = { user_id: authUser.id, media_url: mediaUrl, caption: cap.value.trim() || null };
            if (isStory) row.media_type = isVideo ? "video" : "image";
            const { error } = await supabaseClient.from(isStory ? "profile_stories" : "profile_posts").insert(row);
            if (error) throw error;
            close();
            gToast(isStory ? "Story shared for 24 hours" : "Post shared");
            if (done) done();
        } catch (e) {
            console.error(e);
            alert("Could not share: " + (e.message || e));
            share.disabled = false;
            label.textContent = isStory ? "Your story" : "Share post";
        }
    });

    root.append(top, stage, cap, bar);
    document.body.appendChild(root);
}

// ---------- B. Hot Seat inside the voice room ----------
const VHS = { ch: null, poll: null, tick: null, ro: null, key: "", state: null, rev: -1, els: {}, sig: "", osig: "", asig: "" };

function vhsDelay(i) { return Math.round(70 + 2.75 * i * i); }
function vhsSpinTotal(n) { let t = 0; for (let i = 0; i < n; i++) t += vhsDelay(i); return t; }
function vhsNow() { return Date.now() + (HS.offset || 0); }

// Players who joined the game AND are sitting on a voice seat on this device's view
function vSeatedPlayers(s) {
    if (!vRoom || !vState) return [];
    const names = new Set((s.players || []).map(p => p.u));
    const all = vUsers().filter(u => u.username !== vState.username).concat([vState]);
    return all.filter(u => u.seat !== null && u.seat !== undefined && names.has(u.username)).map(u => u.username);
}

// Overrides the old rotation: the pick is fully random (repeats allowed) and comes with a roulette path
function hsPickNext(s) {
    s.counts = s.counts || {};
    let pool = (s.players || []).map(p => p.u);
    try {
        const seated = vSeatedPlayers(s);
        if (seated.length) pool = seated;
    } catch (e) { console.error(e); }
    if (!pool.length) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const n = 14 + Math.floor(Math.random() * 5);
    const path = [];
    let prev = null;
    for (let i = 0; i < n - 1; i++) {
        let c, g = 0;
        do { c = pool[Math.floor(Math.random() * pool.length)]; g++; } while (pool.length > 1 && c === prev && g < 25);
        path.push(c);
        prev = c;
    }
    if (pool.length > 1 && path[path.length - 1] === pick) {
        const other = pool.filter(u => u !== pick);
        path[path.length - 1] = other[Math.floor(Math.random() * other.length)];
    }
    path.push(pick);
    const t0 = Math.round(hsNow());
    s.seat = pick;
    s.counts[pick] = (s.counts[pick] || 0) + 1;
    s.phase = "asking";
    s.passed = false;
    s.spin = { id: Math.random().toString(36).slice(2), t0, path };
    s.endsAt = t0 + vhsSpinTotal(n) + 700 + HS_SECONDS * 1000;   // the 60 seconds start after the spin
    s.qs = [];
    s.round = (s.round || 0) + 1;
}

async function vhsStart() {
    vhsStop();
    if (!vRoom) return;
    VHS.key = String(vRoom.id) + "_hot";
    HS.key = VHS.key;
    HS.loaded = false; HS.rev = 0; HS.state = null;
    const row = await hsGet();
    if (row) hsApply(row, true);
    if (!vRoom) return;
    const key = VHS.key;
    VHS.ch = supabaseClient.channel("vhot-" + key)
        .on("postgres_changes",
            { event: "*", schema: "public", table: "room_games", filter: "room_id=eq." + key },
            p => { const r = p.new; if (r && r.state) hsApply({ state: r.state, rev: r.rev }); })
        .subscribe();
    VHS.poll = setInterval(async () => { const r = await hsGet(); if (r) hsApply(r); }, 3000);
    VHS.tick = setInterval(vhsTick, 90);
}

function vhsStop() {
    if (VHS.poll) { clearInterval(VHS.poll); VHS.poll = null; }
    if (VHS.tick) { clearInterval(VHS.tick); VHS.tick = null; }
    if (VHS.ch) { supabaseClient.removeChannel(VHS.ch); VHS.ch = null; }
    if (VHS.ro) { VHS.ro.disconnect(); VHS.ro = null; }
    const box = $("vHot"); if (box) box.remove();
    const bar = $("vHotBar"); if (bar) bar.remove();
    const g = $("vSeats"); if (g) g.style.display = "";
    VHS.key = ""; VHS.state = null; VHS.rev = -1; VHS.els = {}; VHS.sig = ""; VHS.osig = ""; VHS.asig = "";
}

// Which player is lit right now (the roulette path is replayed from the shared start time)
function vhsSel() {
    const s = VHS.state, sp = s && s.spin;
    if (!sp || !sp.path || !sp.path.length) return { spinning: false, lit: s ? s.seat : null };
    const el = vhsNow() - sp.t0;
    if (el >= vhsSpinTotal(sp.path.length)) return { spinning: false, lit: s.seat };
    if (el < 0) return { spinning: true, lit: sp.path[0] };
    let i = 0, acc = 0;
    while (i < sp.path.length - 1 && acc + vhsDelay(i) <= el) { acc += vhsDelay(i); i++; }
    return { spinning: true, lit: sp.path[i] };
}

function vhsFreeSeat() {
    const used = new Set(vUsers().filter(u => u.seat !== null && u.seat !== undefined).map(u => u.seat));
    for (let i = 0; i < vSeatCount(); i++) if (!used.has(i)) return i;
    return -1;
}

function vhsBuild() {
    const box = gEl("div", "vh");
    box.id = "vHot";
    box.innerHTML =
        '<svg class="vh-lines" xmlns="http://www.w3.org/2000/svg"><defs>' +
            '<marker id="vhA" viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" orient="auto"><path d="M0 1L9 5L0 9z" fill="#B9A3AB"/></marker>' +
            '<marker id="vhB" viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse" markerWidth="14" markerHeight="14" orient="auto"><path d="M0 1L9 5L0 9z" fill="#FF7A18"/></marker>' +
        '</defs><g id="vhLines"></g></svg>' +
        '<div class="vh-col" id="vhL"></div>' +
        '<div class="vh-center" id="vhC">' +
            '<div class="vh-title">🔥 HOT SEAT</div>' +
            '<div class="vh-name" id="vhName"></div>' +
            '<div class="vh-sub" id="vhSub"></div>' +
            '<div class="vh-time" id="vhTime"></div>' +
            '<div class="vh-act" id="vhAct"></div>' +
        '</div>' +
        '<div class="vh-col" id="vhR"></div>' +
        '<div class="vh-others" id="vhOthers"></div>';
    if (window.ResizeObserver) {
        VHS.ro = new ResizeObserver(() => vhsLines());
        VHS.ro.observe(box);
        VHS.ro.observe(box.querySelector("#vhC"));
    }
    return box;
}

// Draws one arrow from every player's seat to the centre card
function vhsLines() {
    const box = $("vHot"), c = $("vhC");
    if (!box || !c) return;
    const svg = box.querySelector(".vh-lines");
    const g = svg.querySelector("#vhLines");
    const br = box.getBoundingClientRect(), cr = c.getBoundingClientRect();
    if (!br.width) return;
    svg.setAttribute("viewBox", "0 0 " + br.width + " " + br.height);
    const X = cr.left - br.left + cr.width / 2;
    const Y = cr.top - br.top + cr.height / 2;
    Object.keys(VHS.els).forEach(u => {
        const e = VHS.els[u];
        if (!e.line) {
            e.line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            e.line.setAttribute("marker-end", "url(#vhA)");
            g.appendChild(e.line);
        }
        const r = e.circle.getBoundingClientRect();
        const px = r.left - br.left + r.width / 2, py = r.top - br.top + r.height / 2;
        const dx = px - X, dy = py - Y, d = Math.hypot(dx, dy) || 1;
        const k = Math.min(cr.width / 2 / Math.max(Math.abs(dx), 0.001), cr.height / 2 / Math.max(Math.abs(dy), 0.001), 1);
        e.line.setAttribute("x1", px - (dx / d) * (r.width / 2 + 6));
        e.line.setAttribute("y1", py - (dy / d) * (r.width / 2 + 6));
        e.line.setAttribute("x2", X + dx * k + (dx / d) * 6);
        e.line.setAttribute("y2", Y + dy * k + (dy / d) * 6);
    });
}

function vhsBar() {
    let bar = $("vHotBar");
    const s = VHS.state;
    if (!(s && s.status === "lobby" && vState && vRoom)) { if (bar) bar.remove(); return; }
    if (!bar) { bar = gEl("div", "vh-bar"); bar.id = "vHotBar"; $("vSeats").before(bar); }
    const me = vState.username;
    const joined = (s.players || []).some(p => p.u === me);
    const sig = [s.players.length, joined, s.host === me].join("|");
    if (bar.dataset.sig === sig) return;
    bar.dataset.sig = sig;
    bar.innerHTML = "";
    bar.append(gEl("span", "", "🔥 Hot Seat is starting · " + s.players.length + " joined"));
    if (!joined) bar.append(gBtn("Join", "vh-b", hsJoin));
    else if (s.host === me) {
        const st = gBtn(s.players.length < 2 ? "Need 2+" : "Start", "vh-b", hsStartGame);
        if (s.players.length < 2) st.disabled = true;
        bar.append(st);
    }
}

function vhsActions() {
    const s = VHS.state, box = $("vhAct");
    if (!s || !box || !vState) return;
    const me = vState.username;
    const joined = (s.players || []).some(p => p.u === me);
    const seated = vState.seat !== null && vState.seat !== undefined;
    const sig = [s.phase, joined, seated, s.host === me, s.round].join("|");
    if (sig === VHS.asig) return;
    VHS.asig = sig;
    box.innerHTML = "";
    if (!seated) {
        box.append(gBtn("Take a seat", "vh-btn", () => {
            const i = vhsFreeSeat();
            if (i < 0) { gToast("All seats are taken"); return; }
            takeSeat(i);
        }));
    } else if (!joined) {
        box.append(gBtn("Join Hot Seat", "vh-btn", hsJoin));
    }
    if (joined && s.phase === "done") box.append(gBtn("Spin again", "vh-btn main", hsNext));
    if (s.host === me) box.append(gBtn("End game", "vh-btn ghost", () => { if (confirm("End the Hot Seat game?")) hsEnd(); }));
}

function vhsPaint() {
    const s = VHS.state;
    if (!s || s.status !== "playing" || !$("vHot") || !vState) return;
    const sel = vhsSel();
    const me = vState.username;
    Object.keys(VHS.els).forEach(u => {
        const e = VHS.els[u], isLit = u === sel.lit;
        e.circle.classList.toggle("scan", sel.spinning && isLit);
        e.circle.classList.toggle("hot", !sel.spinning && isLit && s.phase === "asking");
        e.circle.classList.toggle("done", !sel.spinning && isLit && s.phase === "done");
        if (e.line) {
            e.line.classList.toggle("lit", isLit);
            e.line.setAttribute("marker-end", isLit ? "url(#vhB)" : "url(#vhA)");
        }
    });
    let name = "", sub = "", time = "";
    const winner = (s.players || []).find(p => p.u === s.seat);
    if (sel.spinning) { name = "Spinning..."; sub = "WHO'S NEXT?"; }
    else if (winner) {
        name = winner.n || winner.u;
        if (s.phase === "asking") {
            sub = s.seat === me ? "YOUR TURN" : "ON THE HOT SEAT";
            time = Math.max(0, Math.ceil((s.endsAt - vhsNow()) / 1000)) + "s";
        } else sub = s.passed ? "PASSED" : "TIME'S UP";
    }
    const set = (id, t) => { const el = $(id); if (el && el.textContent !== t) el.textContent = t; };
    set("vhName", name); set("vhSub", sub); set("vhTime", time);
    $("vHot").classList.toggle("mine", !sel.spinning && s.phase === "asking" && s.seat === me);
}

function vhsTick() {
    const s = VHS.state;
    if (!s || s.status !== "playing" || !$("vHot") || !vState) return;
    vhsPaint();
    // Whoever notices first ends the turn; the revision check lets only one write win
    if (s.phase === "asking" && s.endsAt && vhsNow() >= s.endsAt && !HS.firing) {
        HS.firing = true;
        hsMutate(x => (!x || x.phase !== "asking" || hsNow() < x.endsAt) ? null : Object.assign(x, { phase: "done", passed: false }))
            .finally(() => { HS.firing = false; });
    }
}

function vhsLayout() {
    const grid = $("vSeats");
    if (!grid || !vState || !vRoom) return;
    vhsBar();
    const s = VHS.state;
    const on = !!(s && s.status === "playing");
    let box = $("vHot");
    if (!on) {
        if (box) {
            if (VHS.ro) { VHS.ro.disconnect(); VHS.ro = null; }
            box.remove();
            VHS.els = {}; VHS.sig = ""; VHS.osig = ""; VHS.asig = "";
        }
        grid.style.display = "";
        return;
    }
    grid.style.display = "none";
    if (!box) {
        box = vhsBuild();
        grid.after(box);
        VHS.els = {}; VHS.sig = ""; VHS.osig = ""; VHS.asig = "";
    }

    const me = vState.username;
    const names = new Set((s.players || []).map(p => p.u));
    const everyone = vUsers().filter(u => u.username !== me).concat([vState]);
    const seated = everyone.filter(u => u.seat !== null && u.seat !== undefined);
    const actives = seated.filter(u => names.has(u.username)).sort((a, b) => a.seat - b.seat);
    const others = seated.filter(u => !names.has(u.username)).sort((a, b) => a.seat - b.seat);
// Rebuild the two columns only when the set of players (or a name/photo) changed
    const sig = actives.map(u => u.username + "|" + (u.name || "") + "|" + (u.avatar || "")).join(",");
    if (sig !== VHS.sig) {
        VHS.sig = sig;
        const L = $("vhL"), R = $("vhR");
        L.innerHTML = ""; R.innerHTML = "";
        box.querySelector("#vhLines").innerHTML = "";
        VHS.els = {};
        const n = actives.length;
        box.style.setProperty("--sz", (n <= 4 ? 64 : n <= 8 ? 54 : 46) + "px");
        const half = Math.ceil(n / 2);
        actives.forEach((u, i) => {
            const cell = gEl("div", "v-seat");
            const circle = gEl("div", "v-circle");
            paintAvatar(circle, u.avatar, u.name || u.username);
            const badge = gEl("i", "v-badge");
            badge.innerHTML = VIC.micOff;
            const hand = gEl("i", "v-hand");
            hand.innerHTML = VIC.hand;
            circle.append(badge, hand);
            cell.append(circle, gEl("span", "v-label", u.name || u.username));
            cell.addEventListener("click", () => onSeatTap(u.seat, u));
            (i < half ? L : R).appendChild(cell);
            VHS.els[u.username] = { seat: cell, circle, badge, hand, line: null };
        });
        requestAnimationFrame(vhsLines);
    }

    actives.forEach(u => {
        const e = VHS.els[u.username];
        if (!e) return;
        e.circle.classList.toggle("speaking", !!(u.speaking && !u.muted));
        e.circle.classList.toggle("host", u.username === vHost);
        e.badge.style.display = u.muted ? "" : "none";
        e.hand.style.display = u.hand ? "" : "none";
    });

    const osig = others.map(u => u.username + "|" + (u.avatar || "")).join(",");
    if (osig !== VHS.osig) {
        VHS.osig = osig;
        const o = $("vhOthers");
        o.innerHTML = "";
        others.forEach(u => {
            const it = gEl("div", "vh-o");
            const c = gEl("div", "v-circle");
            paintAvatar(c, u.avatar, u.name || u.username);
            it.append(c, gEl("span", "", u.name || u.username));
            it.addEventListener("click", () => onSeatTap(u.seat, u));
            o.appendChild(it);
        });
    }

    vhsActions();
    vhsPaint();
}

// Hooks (guarded, so a missing earlier block can never break the app)
if (typeof hsApply === "function") {
    const _hsApply6 = hsApply;
    hsApply = function (row, force) {
        _hsApply6(row, force);
        try {
            if (VHS.key && HS.key === VHS.key && vRoom) {
                VHS.state = HS.state;
                VHS.rev = HS.rev;
                renderVoice();
            }
        } catch (e) { console.error(e); }
    };
}
if (typeof renderVoice === "function") {
    const _renderVoice6 = renderVoice;
    renderVoice = function () {
        _renderVoice6();
        try { vhsLayout(); } catch (e) { console.error(e); }
    };
}
if (typeof openVoiceRoom === "function") {
    const _openVoiceRoom6 = openVoiceRoom;
    openVoiceRoom = async function () {
        await _openVoiceRoom6.apply(this, arguments);
        try { vhsStart(); } catch (e) { console.error(e); }
    };
}
if (typeof closeVoice === "function") {
    const _closeVoice6 = closeVoice;
    closeVoice = async function () {
        try { vhsStop(); } catch (e) { console.error(e); }
        return _closeVoice6.apply(this, arguments);
    };
}
// ---------- C. Avatar maker with Girl / Boy ----------
const AVB = {
    genders: ["Girl", "Boy"],
    styles: [["Bob", "Long", "Bun", "Short", "Curly", "Pigtails"], ["Short", "Buzz", "Quiff", "Messy", "Curly", "Long"]],
    acc: [["None", "Glasses", "Bow", "Headphones", "Flowers", "Cat ears"], ["None", "Glasses", "Cap", "Headphones", "Beanie", "Earring"]],
    beard: ["None", "Stubble", "Mustache", "Beard"]
};
const AVB_DEFAULT = { g: 0, skin: 1, hair: 1, style: 0, eyes: 0, mouth: 0, acc: 0, bg: 0, shirt: 0, beard: 0 };

function avClamp2(c) {
    const lim = { g: 2, skin: AV.skin.length, hair: AV.hair.length, eyes: AV.eyes.length, mouth: AV.mouth.length,
                  bg: AV.bg.length, shirt: AV.shirt.length, beard: 4, style: 6, acc: 6 };
    Object.keys(lim).forEach(k => {
        const n = Number(c[k]);
        c[k] = Number.isInteger(n) && n >= 0 && n < lim[k] ? n : AVB_DEFAULT[k];
    });
    if (c.g === 0) c.beard = 0;
    return c;
}

function av2Hair(g, s, hair) {
    const bangs = '<path d="M52 98C48 58 74 36 100 36s52 22 48 62c-6-16-22-30-48-30S58 82 52 98z" fill="' + hair + '"/>';
    const shortH = '<path d="M50 104C44 56 72 32 100 32s56 24 50 72c-2-18-8-28-18-36-14 8-48 8-62 0-10 8-16 18-18 36z" fill="' + hair + '"/>';
    const buzz = '<path d="M54 96C52 60 74 42 100 42s48 18 46 54c-4-12-12-22-24-28-14 6-34 6-48 0-12 6-18 16-22 28z" fill="' + hair + '"/>';
    if (g === 0) {
        return [
            { back: '<path d="M47 104C41 54 70 30 100 30s59 24 53 74c0 24-6 38-14 44H61c-8-6-14-20-14-44z" fill="' + hair + '"/>', front: bangs },
            { back: '<path d="M46 104C40 52 70 28 100 28s60 24 54 76l6 74c-22 8-98 8-120 0z" fill="' + hair + '"/>',
              front: '<path d="M52 98C46 56 74 34 100 34s54 22 48 64c-4-22-20-38-48-40-28 2-44 18-48 40z" fill="' + hair + '"/>' },
            { back: "", front: '<circle cx="100" cy="30" r="17" fill="' + hair + '"/>' + bangs },
            { back: "", front: shortH },
            { back: '<g fill="' + hair + '"><circle cx="56" cy="70" r="16"/><circle cx="70" cy="46" r="17"/><circle cx="96" cy="36" r="18"/><circle cx="126" cy="42" r="17"/><circle cx="144" cy="66" r="16"/><circle cx="48" cy="98" r="14"/><circle cx="152" cy="98" r="14"/></g>', front: bangs },
            { back: '<g fill="' + hair + '"><ellipse cx="42" cy="128" rx="15" ry="28"/><ellipse cx="158" cy="128" rx="15" ry="28"/></g>',
              front: bangs + '<circle cx="48" cy="100" r="6" fill="#FF6FA5"/><circle cx="152" cy="100" r="6" fill="#FF6FA5"/>' }
        ][s];
    }
    return [
        { back: "", front: shortH },
        { back: "", front: buzz },
        { back: "", front: shortH + '<path d="M62 52C70 26 112 16 138 44C116 36 86 38 62 52z" fill="' + hair + '"/>' },
        { back: "", front: shortH + '<path d="M64 46L56 22L82 38zM88 38L90 12L110 36zM114 38L130 16L138 44z" fill="' + hair + '"/>' },
        { back: '<g fill="' + hair + '"><circle cx="64" cy="64" r="15"/><circle cx="82" cy="46" r="16"/><circle cx="106" cy="40" r="17"/><circle cx="128" cy="50" r="16"/><circle cx="141" cy="72" r="14"/></g>', front: buzz },
        { back: '<path d="M46 104C40 52 70 28 100 28s60 24 54 76l4 60c-20 8-96 8-116 0z" fill="' + hair + '"/>', front: shortH }
    ][s];
}

function avSvg2(c) {
    const g = c.g;
    const skin = AV.skin[c.skin], hair = AV.hair[c.hair], bg = AV.bg[c.bg], shirt = AV.shirt[c.shirt];
    const ink = "#2B2024";
    const hp = av2Hair(g, c.style, hair);

    const eyes = [
        '<circle cx="80" cy="98" r="5.5" fill="' + ink + '"/><circle cx="120" cy="98" r="5.5" fill="' + ink + '"/><circle cx="82" cy="96" r="1.8" fill="#fff"/><circle cx="122" cy="96" r="1.8" fill="#fff"/>',
        '<path d="M72 100Q80 89 88 100M112 100Q120 89 128 100" fill="none" stroke="' + ink + '" stroke-width="3.5" stroke-linecap="round"/>',
        '<ellipse cx="80" cy="98" rx="7.5" ry="9" fill="' + ink + '"/><ellipse cx="120" cy="98" rx="7.5" ry="9" fill="' + ink + '"/><circle cx="83" cy="94" r="3" fill="#fff"/><circle cx="123" cy="94" r="3" fill="#fff"/><circle cx="77" cy="102" r="1.6" fill="#fff"/><circle cx="117" cy="102" r="1.6" fill="#fff"/>',
        '<circle cx="80" cy="98" r="5.5" fill="' + ink + '"/><circle cx="82" cy="96" r="1.8" fill="#fff"/><path d="M112 99Q120 90 128 99" fill="none" stroke="' + ink + '" stroke-width="3.5" stroke-linecap="round"/>'
    ][c.eyes];
    const mouth = [
        '<path d="M88 118Q100 130 112 118" fill="none" stroke="' + ink + '" stroke-width="3.5" stroke-linecap="round"/>',
        '<path d="M89 117Q100 134 111 117Z" fill="#7A2E3E"/><path d="M93 124Q100 130 107 124Z" fill="#FF8FA8"/>',
        '<path d="M86 118Q93 126 100 118Q107 126 114 118" fill="none" stroke="' + ink + '" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>',
        '<path d="M90 120Q102 124 112 114" fill="none" stroke="' + ink + '" stroke-width="3.5" stroke-linecap="round"/>'
    ][c.mouth];

    const glasses = '<g fill="rgba(255,255,255,.28)" stroke="' + ink + '" stroke-width="3"><circle cx="80" cy="97" r="14"/><circle cx="120" cy="97" r="14"/><path d="M94 97h12"/></g>';
    const phones = '<path d="M54 100C48 38 152 38 146 100" fill="none" stroke="#3A3A4A" stroke-width="7" stroke-linecap="round"/><rect x="44" y="92" width="14" height="30" rx="7" fill="#3A3A4A"/><rect x="142" y="92" width="14" height="30" rx="7" fill="#3A3A4A"/>';
    let accBack = "", accFront = "";
    if (g === 0) {
        if (c.acc === 1) accFront = glasses;
        else if (c.acc === 2) accFront = '<g transform="translate(64 50) rotate(-18)"><path d="M0 0C-12-14-22-6-18 4S-4 8 0 0z" fill="#FF6FA5"/><path d="M0 0C12-14 22-6 18 4S4 8 0 0z" fill="#FF6FA5"/><circle r="5" fill="#E0457F"/></g>';
        else if (c.acc === 3) accFront = phones;
        else if (c.acc === 4) {
            const pts = [[64, 74, "#FFFFFF"], [80, 58, "#FF9EC4"], [100, 52, "#FFFFFF"], [120, 58, "#FF9EC4"], [136, 74, "#FFFFFF"]];
            accFront = pts.map(p => '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="7" fill="' + p[2] + '"/><circle cx="' + p[0] + '" cy="' + p[1] + '" r="2.6" fill="#F5C84A"/>').join("");
        } else if (c.acc === 5) {
            accBack = '<path d="M58 66L62 24L90 46z" fill="' + hair + '"/><path d="M142 66L138 24L110 46z" fill="' + hair + '"/><path d="M64 56L66 36L80 48z" fill="#FF9EC4"/><path d="M136 56L134 36L120 48z" fill="#FF9EC4"/>';
        }
    } else {
        if (c.acc === 1) accFront = glasses;
        else if (c.acc === 2) accFront =
            '<path d="M48 82C48 40 76 26 102 28c28 2 50 18 50 54z" fill="' + shirt + '"/>' +
            '<path d="M96 76h66c2 0 3 6 0 9-8 8-44 10-66 4z" fill="' + shirt + '"/><path d="M96 78h66" stroke="rgba(0,0,0,.25)" stroke-width="3"/>';
        else if (c.acc === 3) accFront = phones;
        else if (c.acc === 4) accFront =
            '<path d="M48 84C46 38 80 24 100 24s54 14 52 60z" fill="' + shirt + '"/>' +
            '<rect x="46" y="74" width="108" height="16" rx="8" fill="' + shirt + '"/><rect x="46" y="74" width="108" height="16" rx="8" fill="rgba(0,0,0,.2)"/>' +
            '<circle cx="100" cy="22" r="9" fill="' + shirt + '"/>';
        else if (c.acc === 5) accFront = '<circle cx="56" cy="114" r="3.8" fill="#F5C84A"/>';
    }

    let beardBack = "", must = "", brows = "";
    if (g === 1) {
        brows = '<path d="M70 85Q80 80 90 85M110 85Q120 80 130 85" fill="none" stroke="' + ink + '" stroke-width="4" stroke-linecap="round" opacity=".55"/>';
        if (c.beard === 1) beardBack = '<path d="M62 108Q64 144 100 148Q136 144 138 108Q122 126 100 126Q78 126 62 108z" fill="#000" opacity=".14"/>';
        else if (c.beard === 3) beardBack = '<path d="M55 106Q54 152 100 160Q146 152 145 106Q140 134 100 138Q60 134 55 106z" fill="' + hair + '"/>';
        if (c.beard === 2 || c.beard === 3) must = '<path d="M83 117Q91 109 100 114Q109 109 117 117Q109 123 100 118Q91 123 83 117z" fill="' + hair + '"/>';
    }

    const torso = g === 0
        ? '<path d="M26 206C26 168 62 154 100 154s74 14 74 52z" fill="' + shirt + '"/><path d="M82 155Q100 182 118 155z" fill="' + skin + '"/>'
        : '<path d="M20 206C20 168 58 154 100 154s80 14 80 52z" fill="' + shirt + '"/><path d="M84 154Q100 174 116 154z" fill="' + skin + '"/>' +
          '<path d="M84 154Q100 174 116 154" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="4" stroke-linecap="round"/>';

    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">' +
        '<rect width="200" height="200" fill="' + bg + '"/>' +
        '<path d="M30 38l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="#fff" opacity=".7"/>' +
        '<path d="M168 150l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#fff" opacity=".6"/>' +
        hp.back + accBack + torso +
        '<rect x="88" y="130" width="24" height="30" rx="8" fill="' + skin + '"/>' +
        '<path d="M88 146Q100 156 112 146V132H88z" fill="#000" opacity=".1"/>' +
        '<circle cx="56" cy="100" r="7" fill="' + skin + '"/><circle cx="144" cy="100" r="7" fill="' + skin + '"/>' +
        '<ellipse cx="100" cy="96" rx="44" ry="48" fill="' + skin + '"/>' +
        '<ellipse cx="68" cy="112" rx="9" ry="5.5" fill="#FF8FB1" opacity=".38"/><ellipse cx="132" cy="112" rx="9" ry="5.5" fill="#FF8FB1" opacity=".38"/>' +
        beardBack + eyes + brows + mouth + must + hp.front + accFront +
        '</svg>';
}

function avBlob(cfg) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const c = document.createElement("canvas");
            c.width = c.height = 512;
            c.getContext("2d").drawImage(img, 0, 0, 512, 512);
            c.toBlob(b => b ? resolve(b) : reject(new Error("Could not render the avatar")), "image/jpeg", 0.92);
        };
        img.onerror = () => reject(new Error("Could not render the avatar"));
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(avSvg2(cfg));
    });
}
function openAvatarMaker() {
    if (!myProfile || !authUser) return;
    let cfg = Object.assign({}, AVB_DEFAULT);
    try { Object.assign(cfg, JSON.parse(localStorage.getItem("avatarCfg") || "{}")); } catch (e) {}
    cfg = avClamp2(cfg);

    const page = openSubPage("avatarPage", "Make your avatar");
    const useBtn = gBtn("Use", "sp-save", save);
    page.querySelector(".sp-gap").replaceWith(useBtn);
    const body = page.querySelector(".sp-body");

    const prev = gEl("div", "p3-avprev");
    const tools = gEl("div", "pe-btns");
    tools.style.justifyContent = "center";
    tools.appendChild(gBtn("Randomize", "pe-btn", () => {
        const r = n => Math.floor(Math.random() * n);
        cfg.skin = r(AV.skin.length); cfg.hair = r(AV.hair.length); cfg.style = r(6); cfg.eyes = r(AV.eyes.length);
        cfg.mouth = r(AV.mouth.length); cfg.acc = r(6); cfg.bg = r(AV.bg.length); cfg.shirt = r(AV.shirt.length);
        cfg.beard = cfg.g === 1 ? r(4) : 0;
        draw();
    }));

    const gSec = gEl("div", "pe-section");
    gSec.appendChild(gEl("div", "pe-label", "I am"));
    const gRow = gEl("div", "p3-row");
    const gBtns = AVB.genders.map((t, i) => {
        const b = gBtn(t, "p3-chip big", () => {
            if (cfg.g === i) return;
            cfg.g = i; cfg.style = 0; cfg.acc = 0; cfg.beard = 0;
            buildGroups();
            draw();
        });
        gRow.appendChild(b);
        return b;
    });
    gSec.appendChild(gRow);

    const box = gEl("div");
    body.append(prev, tools, gSec, box);

    let groups = {};
    function addGroup(label, key, labels, colors) {
        const sec = gEl("div", "pe-section");
        sec.appendChild(gEl("div", "pe-label", label));
        const row = gEl("div", "p3-row");
        const btns = [];
        (colors || labels).forEach((v, i) => {
            const b = gEl("button", colors ? "p3-sw" : "p3-chip", colors ? "" : v);
            b.type = "button";
            if (colors) b.style.background = v;
            b.addEventListener("click", () => { cfg[key] = i; draw(); });
            btns.push(b);
            row.appendChild(b);
        });
        groups[key] = btns;
        sec.appendChild(row);
        box.appendChild(sec);
    }
    function buildGroups() {
        box.innerHTML = "";
        groups = {};
        addGroup("Skin", "skin", null, AV.skin);
        addGroup("Hair style", "style", AVB.styles[cfg.g]);
        addGroup("Hair colour", "hair", null, AV.hair);
        addGroup("Eyes", "eyes", AV.eyes);
        addGroup("Mouth", "mouth", AV.mouth);
        if (cfg.g === 1) addGroup("Facial hair", "beard", AVB.beard);
        addGroup("Accessory", "acc", AVB.acc[cfg.g]);
        addGroup("Outfit", "shirt", null, AV.shirt);
        addGroup("Background", "bg", null, AV.bg);
    }
    function draw() {
        prev.innerHTML = avSvg2(cfg);
        gBtns.forEach((b, i) => b.classList.toggle("on", i === cfg.g));
        Object.keys(groups).forEach(k => groups[k].forEach((b, i) => b.classList.toggle("on", i === cfg[k])));
    }
    buildGroups();
    draw();

    async function save() {
        useBtn.disabled = true;
        useBtn.textContent = "Saving...";
        try {
            const blob = await avBlob(cfg);
            const path = authUser.id + "/avatar-" + crypto.randomUUID() + ".jpg";
            const up = await supabaseClient.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg" });
            if (up.error) throw up.error;
            const url = supabaseClient.storage.from("avatars").getPublicUrl(path).data.publicUrl;
            const r = await supabaseClient.from("profiles").update({ avatar_url: url }).eq("id", authUser.id);
            if (r.error) throw r.error;
            try { localStorage.setItem("avatarCfg", JSON.stringify(cfg)); } catch (e) {}
            await loadProfile();
            renderProfile();
            const pe = document.querySelector("#editPage .pe-av");
            if (pe) paintAvatar(pe, url, myProfile.username);
            page.remove();
            gToast("Avatar updated");
        } catch (e) {
            console.error(e);
            alert("Could not save the avatar: " + (e.message || e));
            useBtn.disabled = false;
            useBtn.textContent = "Use";
        }
    }
}

// ---------- D. Nicknames + chat info page ----------
const NK = { map: {} };

function nickOf(u) { return NK.map[u] || ""; }

function nickApply() {
    document.querySelectorAll("#messages .message-name[data-u]").forEach(el => {
        el.textContent = NK.map[el.dataset.u] || el.dataset.orig || el.dataset.u;
    });
    const dm = currentRoom ? dmOf(currentRoom) : null;
    if (dm && !$("chatPage").classList.contains("hidden")) {
        $("roomName").textContent = NK.map[dm.username] || dm.display_name || dm.username;
    }
}

async function nickLoad() {
    if (!currentRoom || !authUser) return;
    const rid = String(currentRoom.id);
    const { data, error } = await supabaseClient.rpc("nick_list", { p_room: rid });
    if (error) { console.error("nick_list", error); return; }
    if (!currentRoom || String(currentRoom.id) !== rid) return;
    NK.map = {};
    (data || []).forEach(r => { NK.map[r.username] = r.nickname; });
    nickApply();
}

const _displayMessage7 = displayMessage;
displayMessage = function (m) {
    _displayMessage7(m);
    try {
        if (m && m.id && m.username !== currentUser) {
            const el = document.querySelector('#messages [data-message-id="' + m.id + '"] .message-name');
            if (el && !el.dataset.u) {
                el.dataset.u = m.username;
                el.dataset.orig = el.textContent;
                if (NK.map[m.username]) el.textContent = NK.map[m.username];
            }
        }
    } catch (e) { console.error(e); }
};

const _openChat7 = window.openChat;
window.openChat = async function () {
    NK.map = {};
    const r = await _openChat7.apply(this, arguments);
    nickLoad();
    return r;
};
setInterval(() => { if (currentRoom && !document.hidden) nickLoad(); }, 20000);

function ciNickEdit(room, m, done) {
    const { card, close } = pxModal();
    const inp = gEl("input");
    inp.maxLength = 30;
    inp.placeholder = "Nickname";
    inp.value = nickOf(m.username);
    const save = async v => {
        const { error } = await supabaseClient.rpc("nick_set", { p_room: String(room.id), p_username: m.username, p_nick: v });
        if (error) { console.error(error); gToast(error.message || "Could not save the nickname"); return; }
        close();
        await nickLoad();
        if (done) done();
    };
    card.append(
        gEl("h3", "", "Nickname for " + (m.display_name || m.username)), inp,
        gEl("p", "pt-note", "Everyone in this chat will see it."),
        gBtn("Save", "primary-btn", () => save(inp.value.trim()))
    );
    if (nickOf(m.username)) card.append(gBtn("Remove nickname", "secondary-btn", () => save("")));
    card.append(gBtn("Cancel", "secondary-btn", close));
    inp.focus();
}

async function openChatInfo() {
    const room = currentRoom || vRoom;
    if (!room || !myProfile) return;
    const dm = dmOf(room);
    const inTextChat = !$("chatPage").classList.contains("hidden");
    const page = openSubPage("chatInfoPage", dm ? "Chat info" : "Room info");
    const body = page.querySelector(".sp-body");
    await nickLoad();

    const top = gEl("div", "ci-top");
    const av = gEl("div", "ci-av");
    if (dm) paintAvatar(av, dm.avatar_url, dm.display_name || dm.username);
    else setAvatar(av, room.room_avatar);
    top.append(
        av,
        gEl("div", "ci-name", dm ? (nickOf(dm.username) || dm.display_name || dm.username) : (room.room_name || "Room " + room.room_code)),
        gEl("div", "ci-sub", dm ? "@" + dm.username : "Room code: " + room.room_code)
    );

    const act = gEl("div", "ci-actions");
    const mk = (label, svg, fn) => {
        const b = gEl("button", "ci-act");
        b.type = "button";
        b.innerHTML = svg + "<span>" + label + "</span>";
        b.addEventListener("click", fn);
        return b;
    };
    const I_USER = '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
    const I_EDIT = '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
    const I_SEARCH = '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>';
    if (dm) act.append(mk("Profile", I_USER, () => openUserProfile(dm.username)));
    else act.append(mk("Edit", I_EDIT, () => { page.remove(); openEditRoom(); }));
    if (inTextChat) act.append(mk("Search", I_SEARCH, () => { page.remove(); openSearch(); }));
    body.append(top, act);

    if (inTextChat) {
        body.appendChild(gEl("div", "pe-label", "Customise"));
        const rows = gEl("div");
        [["Chat theme", openChatThemePicker], ["Bubble style", openBubblePicker]].forEach(([t, fn]) => {
            const r = gEl("div", "member-row ci-row");
            const tx = gEl("div", "member-text");
            tx.appendChild(gEl("strong", "", t));
            r.appendChild(tx);
            r.addEventListener("click", fn);
            rows.appendChild(r);
        });
        body.appendChild(rows);
    }

    body.appendChild(gEl("div", "pe-label ci-lab", "Nicknames"));
    const { data } = await supabaseClient.rpc("room_member_list", { p_room: String(room.id) });
    const members = data || [];
    const list = gEl("div");
    function drawRows() {
        list.innerHTML = "";
        members.forEach(m => {
            const row = gEl("div", "member-row ci-row");
            const a = gEl("div", "member-av");
            paintAvatar(a, m.avatar_url, m.display_name || m.username);
            a.addEventListener("click", e => { e.stopPropagation(); openUserProfile(m.username); });
            const tx = gEl("div", "member-text");
            tx.append(
                gEl("strong", "", (m.display_name || m.username) + (m.username === myProfile.username ? " (you)" : "")),
                gEl("span", "", nickOf(m.username) ? "Nickname: " + nickOf(m.username) : "Set nickname")
            );
            row.append(a, tx);
            row.addEventListener("click", () => ciNickEdit(room, m, drawRows));
            list.appendChild(row);
        });
        if (!members.length) list.appendChild(gEl("p", "empty", "No members to show."));
    }
    drawRows();
    body.append(list, gEl("p", "pt-note", "Nicknames are shared with everyone in this chat."));
}

// Tapping the name at the top of a chat opens the new page (instead of the old popup)
document.addEventListener("click", e => {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest("#headerInfo") || t.closest("#voicePage .v-head")) {
        e.stopImmediatePropagation();
        e.preventDefault();
        openChatInfo();
    }
}, true);
// ================================
// SOCIAL v7: Hot Seat room, notes refresh, nicknames in the chat list, Rooms tab tags,
// disappearing messages, voice chat reply/delete + mic/speaker, sending preview, fonts,
// notification delete, any-emoji reactions
// Paste at the very end of auth.js (below SOCIAL v6).
// ================================

// ---------- helpers ----------
// Adds a button to the bottom sheet that is currently open (before Cancel, or after a named item)
function sheetInsert(label, fn, afterLabel) {
    const sheet = document.querySelector(".sheet-backdrop .sheet");
    if (!sheet) return;
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", () => { closeRoomActions(); fn(); });
    if (afterLabel) {
        const ref = Array.from(sheet.querySelectorAll("button")).find(x => x.textContent.trim() === afterLabel);
        if (ref) { ref.after(b); return; }
    }
    sheet.insertBefore(b, sheet.lastElementChild);
}

// The two top-level menus are opened from a document-level capture listener, so the extra items
// appear even though the old click handlers captured the old functions
const _openMainMenu8 = openMainMenu;
function openMainMenuPlus() {
    _openMainMenu8();
    sheetInsert("Font", openFontPicker, "Appearance");
}
async function openChatMenuPlus() {
    await openChatMenu();
    sheetInsert("Disappearing messages", dsOpen, "Bubble style");
}
document.addEventListener("click", e => {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    if (t.closest("#menuBtn")) { e.stopImmediatePropagation(); e.preventDefault(); openMainMenuPlus(); }
    else if (t.closest("#editRoomBtn")) { e.stopImmediatePropagation(); e.preventDefault(); openChatMenuPlus(); }
}, true);

// ---------- 1. Hot Seat room (voice room) ----------
const VH_CHAIR =
    '<svg class="vh-chair" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg"><defs>' +
    '<linearGradient id="vhG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#D36BFF"/><stop offset="1" stop-color="#FF5FA8"/></linearGradient></defs>' +
    '<path d="M40 22l5 11 9-13 6 13 6-13 9 13 5-11 4 20H36z" fill="#FFD76A"/>' +
    '<path d="M32 46c0-13 12-20 28-20s28 7 28 20v32H32z" fill="url(#vhG)"/>' +
    '<path d="M60 68c-3-5-11-4-11 3 0 5 7 10 11 13 4-3 11-8 11-13 0-7-8-8-11-3z" fill="#FFC0E2"/>' +
    '<rect x="22" y="76" width="76" height="20" rx="10" fill="url(#vhG)"/>' +
    '<rect x="14" y="56" width="16" height="44" rx="8" fill="#9A3FD6"/><rect x="90" y="56" width="16" height="44" rx="8" fill="#9A3FD6"/>' +
    '<rect x="30" y="96" width="9" height="16" rx="3" fill="#6A2C9E"/><rect x="81" y="96" width="9" height="16" rx="3" fill="#6A2C9E"/></svg>';

const VH_FLAME = '<svg viewBox="0 0 24 24"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>';

function vhsRandomFree() {
    const used = new Set(vUsers().filter(u => u.seat !== null && u.seat !== undefined).map(u => u.seat));
    const free = [];
    for (let i = 0; i < vSeatCount(); i++) if (!used.has(i)) free.push(i);
    return free.length ? free[Math.floor(Math.random() * free.length)] : -1;
}

// Everyone who joined the game is pulled into the room and sits down when the game starts
function vhsEnter(s) {
    const me = vState.username;
    if (!(s.players || []).some(p => p.u === me)) return;
    const gp = $("gamesPage");
    if (gp && !gp.classList.contains("hidden")) {
        closeGames();
        gToast("Hot Seat has started!");
    }
    if (vState.seat === null || vState.seat === undefined) {
        const i = vhsRandomFree();
        if (i >= 0) takeSeat(i);
    }
}

const _hsApply8 = hsApply;
hsApply = function (row, force) {
    const prev = HS.state ? HS.state.status + ":" + HS.state.round : "";
    _hsApply8(row, force);
    try {
        const s = HS.state;
        const now = s ? s.status + ":" + s.round : "";
        if (s && s.status === "playing" && now !== prev && vRoom && vState) vhsEnter(s);
    } catch (e) { console.error(e); }
};

// Truly random pick (repeats allowed). Uses seated players when at least two are seated.
function hsPickNext(s) {
    s.counts = s.counts || {};
    let pool = (s.players || []).map(p => p.u);
    try {
        const seated = vSeatedPlayers(s);
        if (seated.length >= 2) pool = seated;
    } catch (e) { console.error(e); }
    if (!pool.length) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const n = 14 + Math.floor(Math.random() * 5);
    const path = [];
    let prev = null;
    for (let i = 0; i < n - 1; i++) {
        let c, g = 0;
        do { c = pool[Math.floor(Math.random() * pool.length)]; g++; } while (pool.length > 1 && c === prev && g < 25);
        path.push(c);
        prev = c;
    }
    if (pool.length > 1 && path[path.length - 1] === pick) {
        const other = pool.filter(u => u !== pick);
        path[path.length - 1] = other[Math.floor(Math.random() * other.length)];
    }
    path.push(pick);
    const t0 = Math.round(hsNow());
    s.seat = pick;
    s.counts[pick] = (s.counts[pick] || 0) + 1;
    s.phase = "asking";
    s.passed = false;
    s.spin = { id: Math.random().toString(36).slice(2), t0, path };
    s.endsAt = t0 + vhsSpinTotal(n) + 700 + HS_SECONDS * 1000;
    s.qs = [];
    s.round = (s.round || 0) + 1;
}
// Host can put a specific player on the Hot Seat (no spin)
function hsMakeAnswer(username) {
    hsMutate(x => {
        if (!x || x.status !== "playing" || x.host !== myProfile.username) return null;
        if (!(x.players || []).some(p => p.u === username)) return null;
        x.seat = username;
        x.counts = x.counts || {};
        x.counts[username] = (x.counts[username] || 0) + 1;
        x.phase = "asking";
        x.passed = false;
        x.spin = null;
        x.endsAt = Math.round(hsNow() + HS_SECONDS * 1000);
        x.qs = [];
        x.round = (x.round || 0) + 1;
        return x;
    });
}

const _onSeatTap8 = onSeatTap;
onSeatTap = function (i, u) {
    const s = VHS.state;
    if (u && vState && u.username !== vState.username && s && s.status === "playing") {
        const items = [
            ["View profile", () => openUserProfile(u.username)],
            ["Send message", () => messageFriend({ username: u.username })]
        ];
        if (s.host === vState.username) items.push(["Make them answer", () => hsMakeAnswer(u.username)]);
        if (isHost()) {
            items.push(["Remove from seat", () => {
                vChannel.send({ type: "broadcast", event: "kick", payload: { username: u.username } });
            }, true]);
        }
        items.push(["Cancel", () => {}]);
        showSheet(items, u.name || u.username);
        return;
    }
    return _onSeatTap8(i, u);
};

// Banner above the seats: the game entry when idle, the join/start bar when a game is waiting
function vhsBar() {
    let bar = $("vHotBar");
    const s = VHS.state;
    if (!(vState && vRoom && $("vSeats"))) { if (bar) bar.remove(); return; }
    if (s && s.status === "playing") { if (bar) bar.remove(); return; }
    if (!bar) { bar = gEl("div", "vh-bar"); bar.id = "vHotBar"; $("vSeats").before(bar); }
    const me = vState.username;

    if (s && s.status === "lobby") {
        const joined = (s.players || []).some(p => p.u === me);
        const sig = ["lobby", s.players.length, joined, s.host === me].join("|");
        if (bar.dataset.sig === sig) return;
        bar.dataset.sig = sig;
        bar.className = "vh-bar";
        bar.onclick = null;
        bar.innerHTML = "";
        bar.append(gEl("span", "", "Hot Seat is starting · " + s.players.length + " joined"));
        if (!joined) bar.append(gBtn("Join", "vh-b", hsJoin));
        else if (s.host === me) {
            const st = gBtn(s.players.length < 2 ? "Need 2+" : "Start", "vh-b", hsStartGame);
            if (s.players.length < 2) st.disabled = true;
            bar.append(st);
        }
        return;
    }

    if (bar.dataset.sig === "entry") return;
    bar.dataset.sig = "entry";
    bar.className = "vh-bar entry";
    bar.innerHTML = '<div class="vh-ic">' + VH_FLAME + '</div>' +
        '<div class="vh-et"><strong>Hot Seat</strong><span>Take the hot seat and share anything!</span></div>' +
        '<span class="vh-go">&rsaquo;</span>';
    bar.onclick = () => { openGames(); openHot(); };
}

function vhsBuild() {
    const box = gEl("div", "vh vh2");
    box.id = "vHot";
    box.innerHTML =
        '<svg class="vh-lines" xmlns="http://www.w3.org/2000/svg"><defs>' +
            '<marker id="vhA" viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" orient="auto"><path d="M0 1L9 5L0 9z" fill="#9C8FD0"/></marker>' +
            '<marker id="vhB" viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse" markerWidth="14" markerHeight="14" orient="auto"><path d="M0 1L9 5L0 9z" fill="#FF5FA8"/></marker>' +
        '</defs><g id="vhLines"></g></svg>' +
        '<div class="vh-ring" id="vhRing">' +
            '<div class="vh-center" id="vhC">' + VH_CHAIR +
                '<div class="vh-name" id="vhName"></div>' +
                '<div class="vh-sub" id="vhSub"></div>' +
                '<div class="vh-time" id="vhTime"></div>' +
            '</div>' +
        '</div>' +
        '<div class="vh-act" id="vhAct"></div>' +
        '<div class="vh-others" id="vhOthers"></div>';
    if (window.ResizeObserver) {
        VHS.ro = new ResizeObserver(() => vhsLines());
        VHS.ro.observe(box);
    }
    return box;
}

// Seats are placed on a circle around the chair; 2 players sit left and right
function vhsLayout() {
    const grid = $("vSeats");
    if (!grid || !vState || !vRoom) return;
    vhsBar();
    const s = VHS.state;
    const on = !!(s && s.status === "playing");
    let box = $("vHot");
    if (!on) {
        if (box) {
            if (VHS.ro) { VHS.ro.disconnect(); VHS.ro = null; }
            box.remove();
            VHS.els = {}; VHS.sig = ""; VHS.osig = ""; VHS.asig = "";
        }
        grid.style.display = "";
        return;
    }
    grid.style.display = "none";
    if (!box) {
        box = vhsBuild();
        grid.after(box);
        VHS.els = {}; VHS.sig = ""; VHS.osig = ""; VHS.asig = "";
    }

    const me = vState.username;
    const names = new Set((s.players || []).map(p => p.u));
    const everyone = vUsers().filter(u => u.username !== me).concat([vState]);
    const seated = everyone.filter(u => u.seat !== null && u.seat !== undefined);
    const actives = seated.filter(u => names.has(u.username)).sort((a, b) => a.seat - b.seat);
    const others = seated.filter(u => !names.has(u.username)).sort((a, b) => a.seat - b.seat);

    const sig = actives.map(u => u.username + "|" + (u.name || "") + "|" + (u.avatar || "")).join(",");
    if (sig !== VHS.sig) {
        VHS.sig = sig;
        const ring = $("vhRing");
        ring.querySelectorAll(".v-seat").forEach(e => e.remove());
        box.querySelector("#vhLines").innerHTML = "";
        VHS.els = {};
        const n = actives.length;
        box.style.setProperty("--sz", (n <= 4 ? 66 : n <= 6 ? 58 : n <= 8 ? 50 : 42) + "px");
        const start = n === 2 ? Math.PI : -Math.PI / 2;
        actives.forEach((u, i) => {
            const a = start + (2 * Math.PI * i) / n;
            const cell = gEl("div", "v-seat");
            cell.style.left = (50 + 39 * Math.cos(a)) + "%";
            cell.style.top = (50 + 39 * Math.sin(a)) + "%";
            const circle = gEl("div", "v-circle");
            paintAvatar(circle, u.avatar, u.name || u.username);
            const badge = gEl("i", "v-badge");
            badge.innerHTML = VIC.micOff;
            const hand = gEl("i", "v-hand");
            hand.innerHTML = VIC.hand;
            circle.append(badge, hand);
            cell.append(circle, gEl("span", "v-label", u.name || u.username));
            cell.addEventListener("click", () => onSeatTap(u.seat, u));
            ring.appendChild(cell);
            VHS.els[u.username] = { seat: cell, circle, badge, hand, line: null };
        });
        requestAnimationFrame(vhsLines);
    }

    actives.forEach(u => {
        const e = VHS.els[u.username];
        if (!e) return;
        e.circle.classList.toggle("speaking", !!(u.speaking && !u.muted));
        e.circle.classList.toggle("host", u.username === vHost);
        e.badge.style.display = u.muted ? "" : "none";
        e.hand.style.display = u.hand ? "" : "none";
    });

    const osig = others.map(u => u.username + "|" + (u.avatar || "")).join(",");
    if (osig !== VHS.osig) {
        VHS.osig = osig;
        const o = $("vhOthers");
        o.innerHTML = "";
        others.forEach(u => {
            const it = gEl("div", "vh-o");
            const c = gEl("div", "v-circle");
            paintAvatar(c, u.avatar, u.name || u.username);
            it.append(c, gEl("span", "", u.name || u.username));
            it.addEventListener("click", () => onSeatTap(u.seat, u));
            o.appendChild(it);
        });
    }

    vhsActions();
    vhsPaint();
}

// ---------- 2. Notes refresh + nicknames in the chat list ----------
setInterval(() => {
    const p = $("chatsPage");
    if (p && !p.classList.contains("hidden") && !document.hidden && myProfile) {
        cnRender().catch(e => console.error(e));
    }
}, 15000);

const NKL = {};
async function nkListLoad() {
    const { data, error } = await supabaseClient.rpc("my_nicks");
    if (error) { console.error("my_nicks", error); return; }
    Object.keys(NKL).forEach(k => delete NKL[k]);
    (data || []).forEach(r => {
        if (!NKL[r.room_id]) NKL[r.room_id] = {};
        NKL[r.room_id][r.username] = r.nickname;
    });
}
function nkListApply() {
    document.querySelectorAll("#chatsList .chat-row").forEach(row => {
        const room = row._room;
        if (!room) return;
        const map = NKL[String(room.id)];
        if (!map) return;
        const dm = dmOf(room);
        const strong = row.querySelector(".chat-row-text strong");
        if (dm && strong && map[dm.username]) strong.textContent = map[dm.username];
        const sp = row.querySelector(".chat-row-text span");
        if (sp) {
            Object.keys(map).forEach(u => {
                if (sp.textContent.startsWith(u + ": ")) sp.textContent = map[u] + ": " + sp.textContent.slice(u.length + 2);
            });
        }
    });
}
const _attachRowMenu8 = attachRowMenu;
attachRowMenu = function (row, room) {
    row._room = room;
    return _attachRowMenu8(row, room);
};
const _loadChats8 = loadChats;
loadChats = async function () {
    await _loadChats8();
    try {
        await nkListLoad();
        nkListApply();
        setTimeout(nkListApply, 700);
        setTimeout(nkListApply, 2000);
    } catch (e) { console.error(e); }
};

// ---------- 3. Rooms tab: a small tag instead of the mic / lock emoji ----------
function renderHomeRooms() {
    const box = $("homeRooms");
    const list = homeData.filter(x => homeTab === "all" || x.type === homeTab);
    box.innerHTML = "";
    if (!list.length) {
        const msg = homeTab === "voice" ? "No voice rooms yet. Create one!"
            : homeTab === "text" ? "No text rooms yet."
            : "No rooms yet.";
        box.innerHTML = '<p class="empty">' + msg + "</p>";
        return;
    }
    list.forEach(x => {
        const r = x.room;
        const card = gEl("div", "room-card");
        const av = gEl("div", "room-avatar");
        setAvatar(av, r.room_avatar);
        const text = gEl("div", "room-card-text");
        const title = gEl("strong", "", r.room_name || "Room " + r.room_code);
        const meta = gEl("span", "rm-meta");
        meta.append(
            gEl("em", "rm-tag " + (x.type === "voice" ? "voice" : "text"), x.type === "voice" ? "Voice" : "Text"),
            document.createTextNode(x.members + (x.members === 1 ? " member" : " members"))
        );
        text.append(title, meta);
        const open = gEl("button", "room-open", "Open");
        open.type = "button";
        card.append(av, text, open);
        card.addEventListener("click", () => openRoomFromProfile(r));
        box.appendChild(card);
    });
}

// ---------- 4. Disappearing messages ----------
const DS = { secs: 0 };
const DS_OPTS = [[0, "Off (keep messages)"], [3600, "After 1 hour"], [86400, "After 24 hours"], [604800, "After 7 days"]];
function dsRoom() { return currentRoom || vRoom; }
function dsLabel(s) { const o = DS_OPTS.find(x => x[0] === s); return o ? o[1] : "later"; }

function dsEnsure() {
    const hdr = document.querySelector("#chatPage .chat-header");
    if (hdr && !$("dsPill")) { const p = gEl("div", "ds-pill hidden"); p.id = "dsPill"; hdr.after(p); }
    const vc = $("vChat");
    if (vc && !$("vDsPill")) { const p = gEl("div", "ds-pill hidden"); p.id = "vDsPill"; vc.before(p); }
}
function dsPaint() {
    const txt = DS.secs ? "Messages disappear " + dsLabel(DS.secs).toLowerCase() : "";
    ["dsPill", "vDsPill"].forEach(id => {
        const el = $(id);
        if (!el) return;
        el.textContent = txt;
        el.classList.toggle("hidden", !DS.secs);
    });
}
async function dsPurge() {
    const r = dsRoom();
    if (!r || !DS.secs) return;
    const { error } = await supabaseClient.rpc("purge_room", { p_room: String(r.id) });
    if (error) console.error("purge_room", error);
}
async function dsLoad() {
    const r = dsRoom();
    if (!r) return;
    dsEnsure();
    const { data, error } = await supabaseClient.rpc("disappear_get", { p_room: String(r.id) });
    if (error) { console.error("disappear_get", error); return; }
    DS.secs = Number(data) || 0;
    dsPaint();
    if (DS.secs) dsPurge();
}
function dsOpen() {
    const r = dsRoom();
    if (!r) return;
    const items = DS_OPTS.map(([secs, label]) => [(secs === DS.secs ? "✓ " : "") + label, async () => {
        const { error } = await supabaseClient.rpc("disappear_set", { p_room: String(r.id), p_secs: secs });
        if (error) { console.error(error); gToast(error.message || "Could not change this"); return; }
        DS.secs = secs;
        dsPaint();
        gToast(secs ? "Messages will disappear " + label.toLowerCase() : "Messages will stay until someone deletes them");
        if (secs) dsPurge();
    }]);
    items.push(["Cancel", () => {}]);
    showSheet(items, "Disappearing messages");
}
setInterval(() => { if (!document.hidden && DS.secs && dsRoom()) dsPurge(); }, 60000);

const _openChat8 = window.openChat;
window.openChat = async function () {
    DS.secs = 0;
    dsPaint();
    const r = await _openChat8.apply(this, arguments);
    try { dsLoad(); } catch (e) { console.error(e); }
    return r;
};
// ---------- 5. Voice room: chat reply/delete, small mic + speaker buttons ----------
const VX_ICO = {
    spk: '<svg viewBox="0 0 24 24"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
    spkOff: '<svg viewBox="0 0 24 24"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>'
};
const VSPK = { off: false };
function vSpkApply() { document.querySelectorAll("body > audio").forEach(a => { a.muted = VSPK.off; }); }
function vSpkToggle() {
    VSPK.off = !VSPK.off;
    vSpkApply();
    vMiniSync();
    gToast(VSPK.off ? "Speaker off. You can't hear the room." : "Speaker on");
}
// Audio elements created later (live voice) obey the speaker setting too
new MutationObserver(muts => {
    if (!VSPK.off) return;
    muts.forEach(m => m.addedNodes.forEach(n => { if (n.nodeName === "AUDIO") n.muted = true; }));
}).observe(document.body, { childList: true });

function vMiniSync() {
    const mic = $("vMiniMic"), spk = $("vMiniSpk");
    if (mic && vState) {
        const live = vState.seat !== null && vState.seat !== undefined && !vState.muted;
        mic.innerHTML = live ? VIC.mic : VIC.micOff;
        mic.classList.toggle("live", live);
    }
    if (spk) {
        spk.innerHTML = VSPK.off ? VX_ICO.spkOff : VX_ICO.spk;
        spk.classList.toggle("off", VSPK.off);
    }
}

let vReply = null;
function vStartReply(m) {
    const p = avatarCache[m.username];
    const nm = m.username === myProfile.username ? "You" : ((p && p.display_name) || m.username);
    vReply = {
        id: m.id, name: nm,
        text: m.audio_url ? "Voice message" : m.media_url ? "Photo/Video" : String(m.message || "").slice(0, 80)
    };
    const bar = $("vReplyBar");
    if (!bar) return;
    $("vRbName").textContent = nm;
    $("vRbMsg").textContent = vReply.text;
    bar.classList.remove("hidden");
    const i = $("vInput");
    if (i) i.focus();
}
function vClearReply() {
    vReply = null;
    const bar = $("vReplyBar");
    if (bar) bar.classList.add("hidden");
}

function vExtras() {
    const form = $("vForm");
    if (!form) return;
    if (!$("vReplyBar")) {
        const bar = gEl("div", "v-replybar hidden");
        bar.id = "vReplyBar";
        const tx = gEl("div", "v-rb-tx");
        const n = gEl("strong"); n.id = "vRbName";
        const t = gEl("span"); t.id = "vRbMsg";
        tx.append(n, t);
        bar.append(tx, gBtn("×", "v-rb-x", () => vClearReply()));
        form.before(bar);
    }
    if (!$("vMiniMic")) {
        const send = form.querySelector(".send-btn");
        const mic = gEl("button", "v-mini");
        mic.id = "vMiniMic";
        mic.type = "button";
        mic.setAttribute("aria-label", "Mute or unmute the microphone");
        mic.addEventListener("click", () => toggleMic());
        const spk = gEl("button", "v-mini");
        spk.id = "vMiniSpk";
        spk.type = "button";
        spk.setAttribute("aria-label", "Turn the speaker on or off");
        spk.addEventListener("click", vSpkToggle);
        send.before(mic, spk);
    }
    dsEnsure();
    vMiniSync();
}

function vMsgMenu(m, row) {
    const mine = m.username === myProfile.username;
    const items = [["Reply", () => vStartReply(m)]];
    if (m.message) items.push(["Copy text", () => {
        try { navigator.clipboard.writeText(m.message); gToast("Copied"); } catch (e) {}
    }]);
    if (mine) items.push(["Delete message", () => vDeleteMsg(m, row), true]);
    items.push(["Cancel", () => {}]);
    showSheet(items, "Message");
}

async function vDeleteMsg(m, row) {
    if (!confirm("Delete this message?")) return;
    const { data, error } = await supabaseClient.from("messages").delete().eq("id", m.id).select();
    if (error || !data || !data.length) { console.error(error); gToast("Could not delete it"); return; }
    row.remove();
}

// Long press = menu, swipe sideways = reply, vertical movement = normal scrolling
function vAttachMsg(row, m) {
    let timer = null, sx = 0, sy = 0, mode = null, fired = false;
    const reset = () => {
        row.style.transition = "transform .18s";
        row.style.transform = "";
        setTimeout(() => { row.style.transition = ""; }, 200);
    };
    row.addEventListener("touchstart", e => {
        sx = e.touches[0].clientX;
        sy = e.touches[0].clientY;
        mode = null;
        fired = false;
        timer = setTimeout(() => { fired = true; vMsgMenu(m, row); }, 550);
    }, { passive: true });
    row.addEventListener("touchmove", e => {
        const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
        if (mode === "scroll") return;
        if (mode === null) {
            if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx) * 0.6) { mode = "scroll"; clearTimeout(timer); return; }
            if (Math.abs(dx) > 25 && Math.abs(dx) > Math.abs(dy) * 2.5) { mode = "swipe"; clearTimeout(timer); }
            else return;
        }
        row.style.transform = "translateX(" + Math.max(-60, Math.min(60, dx)) + "px)";
    }, { passive: true });
    row.addEventListener("touchend", e => {
        clearTimeout(timer);
        if (mode === "swipe") {
            const dx = e.changedTouches[0].clientX - sx;
            reset();
            if (Math.abs(dx) > 70) vStartReply(m);
        }
        mode = null;
    });
    row.addEventListener("touchcancel", () => { clearTimeout(timer); mode = null; reset(); });
    row.addEventListener("contextmenu", e => {
        e.preventDefault();
        clearTimeout(timer);
        if (!fired) { fired = true; vMsgMenu(m, row); }
    });
}

function addVoiceMsg(m) {
    const box = $("vChat");
    if (!box || !m) return;
    if (m.id && box.querySelector('[data-id="' + m.id + '"]')) return;
    const p = avatarCache[m.username];
    const name = (NK.map && NK.map[m.username]) || (p && p.display_name) || m.username;

    const row = gEl("div", "v-msg");
    if (m.id) row.dataset.id = m.id;
    row.dataset.u = m.username;

    const av = gEl("div", "v-msg-av");
    paintAvatar(av, p && p.avatar_url, name);
    av.addEventListener("click", e => { e.stopPropagation(); openUserProfile(m.username); });

    const body = gEl("div", "v-msg-body");
    body.appendChild(gEl("strong", "", name));
    if (m.reply_to) {
        const q = gEl("div", "v-quote");
        q.append(gEl("b", "", m.reply_to.name || ""), gEl("span", "", m.reply_to.text || ""));
        q.addEventListener("click", () => {
            const t = box.querySelector('[data-id="' + m.reply_to.id + '"]');
            if (t) t.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        body.appendChild(q);
    }
    body.appendChild(gEl("span", "v-txt", m.audio_url ? "Voice message" : m.media_url ? "Photo/Video" : (m.message || "")));
    row.append(av, body);
    vAttachMsg(row, m);
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
}

async function sendVoiceMessage(e) {
    e.preventDefault();
    const input = $("vInput");
    const text = input.value.trim();
    if (!text || !vRoom) return;
    input.value = "";
    const reply = vReply;
    vClearReply();
    const { error } = await supabaseClient.from("messages").insert({
        room_id: vRoom.id, username: myProfile.username, message: text, reply_to: reply
    });
    if (error) {
        console.error(error);
        alert("Message could not be sent.");
        input.value = text;
    }
}

// Messages deleted by someone else (or by disappearing messages) vanish from the voice chat too
const VDEL = { ch: null };
function vDelStop() {
    if (VDEL.ch) { supabaseClient.removeChannel(VDEL.ch); VDEL.ch = null; }
}
function vDelStart() {
    vDelStop();
    if (!vRoom) return;
    VDEL.ch = supabaseClient.channel("vdel-" + vRoom.id)
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" }, p => {
            const id = p.old && p.old.id;
            if (!id) return;
            const el = document.querySelector('#vChat [data-id="' + id + '"]');
            if (el) el.remove();
        })
        .subscribe();
}

const _buildVoicePage8 = buildVoicePage;
buildVoicePage = function () {
    _buildVoicePage8();
    try { vExtras(); } catch (e) { console.error(e); }
};
const _renderVoice8 = renderVoice;
renderVoice = function () {
    _renderVoice8();
    try { vMiniSync(); } catch (e) { console.error(e); }
};
const _openVoiceRoom8 = openVoiceRoom;
openVoiceRoom = async function () {
    await _openVoiceRoom8.apply(this, arguments);
    try { vExtras(); vDelStart(); } catch (e) { console.error(e); }
};
const _closeVoice8 = closeVoice;
closeVoice = async function () {
    try {
        vDelStop();
        VSPK.off = false;
        vSpkApply();
        vClearReply();
        DS.secs = 0;
        dsPaint();
    } catch (e) { console.error(e); }
    return _closeVoice8.apply(this, arguments);
};
const _openVoiceMenu8 = openVoiceMenu;
openVoiceMenu = function () {
    _openVoiceMenu8();
    sheetInsert("Disappearing messages", dsOpen, "Members");
};

// ---------- 6. Sending a photo/video: it shows right away with a small paper plane ----------
const SEND_ICON = '<svg viewBox="0 0 24 24"><path d="M21 3L10.5 13.5"/><path d="M21 3L15 21L10.5 13.5L3 9L21 3Z"/></svg>';

async function chatSendMedia(file) {
    const room = currentRoom;
    if (!room) return;
    const isVideo = file.type.startsWith("video");
    if (isVideo && file.size > 25 * 1024 * 1024) { alert("Video must be smaller than 25 MB."); return; }

    const local = URL.createObjectURL(file);
    const pending = document.createElement("div");
    pending.className = "message mine pending-media";
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    const wrap = document.createElement("div");
    wrap.className = "media-wrap";
    let el;
    if (isVideo) {
        el = document.createElement("video");
        el.src = local;
        el.muted = true;
        el.playsInline = true;
        el.preload = "metadata";
    } else {
        el = new Image();
        el.src = local;
    }
    el.className = "message-media";
    const plane = document.createElement("span");
    plane.className = "sending-plane";
    plane.innerHTML = SEND_ICON;
    wrap.append(el, plane);
    bubble.appendChild(wrap);
    pending.appendChild(bubble);
    $("messages").appendChild(pending);
    scrollMessages();

    try {
        let body = file, ext = "mp4", type = file.type;
        if (!isVideo) {
            body = await compressImage(file);
            ext = "jpg";
            type = "image/jpeg";
        } else if (file.name && file.name.includes(".")) {
            ext = file.name.split(".").pop();
        }
        const path = room.id + "/" + crypto.randomUUID() + "." + ext;
        const up = await supabaseClient.storage.from("media").upload(path, body, { contentType: type });
        if (up.error) throw up.error;
        const url = supabaseClient.storage.from("media").getPublicUrl(path).data.publicUrl;
        const { data, error } = await supabaseClient.from("messages").insert({
            room_id: room.id, username: currentUser, message: "", media_url: url,
            media_type: isVideo ? "video" : "image", reply_to: replyingTo
        }).select().single();
        if (error) throw error;
        clearReply();

        plane.classList.add("done");
        if (currentRoom && String(currentRoom.id) === String(room.id)) {
            displayMessage(data);
            // Keep showing the local picture until the uploaded one has loaded, so nothing flickers
            const real = document.querySelector('#messages [data-message-id="' + data.id + '"] img.message-media');
            if (real && !isVideo) {
                const finalSrc = real.src;
                real.src = local;
                const pre = new Image();
                pre.onload = () => { real.src = finalSrc; setTimeout(() => URL.revokeObjectURL(local), 1500); };
                pre.src = finalSrc;
            }
        }
        pending.remove();
    } catch (e) {
        console.error(e);
        pending.remove();
        URL.revokeObjectURL(local);
        alert("Could not send.");
    }
}

// Runs before the old handler in app.js and replaces it
document.addEventListener("change", async e => {
    const input = e.target;
    if (!input || input.id !== "mediaFile") return;
    e.stopImmediatePropagation();
    const file = input.files && input.files[0];
    input.value = "";
    if (!file || !currentRoom) return;
    await chatSendMedia(file);
}, true);

// ---------- 7. Fonts ----------
const FONTS = {
    poppins: { label: "Poppins", sub: "Modern & Clean", css: '"Poppins", sans-serif', q: "Poppins:wght@400;500;600;700" },
    nunito: { label: "Nunito", sub: "Cozy & Friendly", css: '"Nunito", sans-serif', q: "Nunito:wght@400;600;700;800" },
    quicksand: { label: "Quicksand", sub: "Soft & Cute", css: '"Quicksand", sans-serif', q: "Quicksand:wght@400;500;600;700" },
    grotesk: { label: "Space Grotesk", sub: "Bold & Gen-Z", css: '"Space Grotesk", sans-serif', q: "Space+Grotesk:wght@400;500;600;700" },
    lora: { label: "Lora", sub: "Elegant & Romantic", css: '"Lora", serif', q: "Lora:wght@400;500;600;700" }
};
function fontLoad(key) {
    const f = FONTS[key];
    if (!f || document.getElementById("font-" + key)) return;
    const l = document.createElement("link");
    l.id = "font-" + key;
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=" + f.q + "&display=swap";
    document.head.appendChild(l);
}
function fontApply(key) {
    const f = FONTS[key];
    const root = document.documentElement;
    if (!f) {
        root.removeAttribute("data-font");
        root.style.removeProperty("--app-font");
        try { localStorage.removeItem("appFont"); } catch (e) {}
        return;
    }
    fontLoad(key);
    root.dataset.font = key;
    root.style.setProperty("--app-font", f.css);
    try { localStorage.setItem("appFont", key); } catch (e) {}
}
function openFontPicker() {
    const body = csPanel("Font");
    let cur = "";
    try { cur = localStorage.getItem("appFont") || ""; } catch (e) {}
    Object.keys(FONTS).forEach(fontLoad);
    const list = gEl("div", "fp-list");
    const add = (key, label, sub, css) => {
        const b = gEl("button", "fp-item" + (key === cur ? " on" : ""));
        b.type = "button";
        const t = gEl("strong", "", label);
        const s = gEl("span", "", sub);
        const m = gEl("em", "", "Hey, what are you up to?");
        if (css) { t.style.fontFamily = css; s.style.fontFamily = css; m.style.fontFamily = css; }
        b.append(t, s, m);
        b.addEventListener("click", () => {
            fontApply(key);
            list.querySelectorAll(".fp-item").forEach(x => x.classList.remove("on"));
            b.classList.add("on");
        });
        list.appendChild(b);
    };
    add("", "Default", "System font", "");
    Object.keys(FONTS).forEach(k => add(k, FONTS[k].label, FONTS[k].sub, FONTS[k].css));
    body.append(list, gEl("p", "pt-note", "Saved on this phone. Applies to the whole app."));
}
try { fontApply(localStorage.getItem("appFont") || ""); } catch (e) {}

// ---------- 8. Notifications: delete one or clear all ----------
async function openNotifications() {
    const page = openSubPage("notifPage", "Notifications", () => refreshBell());
    const box = page.querySelector(".sp-body");
    const empty = () => { box.innerHTML = '<p class="empty">No notifications yet.</p>'; };
    const clearAll = gBtn("Clear all", "sp-link", async () => {
        if (!box.querySelector(".notif-row")) return;
        if (!confirm("Delete all notifications?")) return;
        const { error } = await supabaseClient.rpc("notif_clear");
        if (error) { console.error(error); gToast("Could not clear them"); return; }
        empty();
        refreshBell();
    });
    page.querySelector(".sp-gap").replaceWith(clearAll);
    box.innerHTML = '<p class="empty">Loading...</p>';

    const { data, error } = await supabaseClient.rpc("my_notifications");
    box.innerHTML = "";
    if (error) {
        console.error(error);
        box.innerHTML = '<p class="empty">Could not load notifications.</p>';
        return;
    }
    const list = data || [];
    if (!list.length) empty();

    const texts = {
        friend_request: "sent you a friend request",
        friend_accepted: "accepted your friend request",
        dm_request: "sent you a message request",
        dm_accepted: "accepted your message request",
        post_like: "liked your post",
        post_comment: "commented on your post",
        story_like: "liked your story"
    };

    list.forEach(n => {
        const row = document.createElement("div");
        row.className = "member-row notif-row" + (n.is_read ? "" : " unread");
        row.style.cursor = "pointer";

        const av = document.createElement("div");
        av.className = "member-av";
        paintAvatar(av, n.avatar_url, n.display_name || n.username);

        const txt = document.createElement("div");
        txt.className = "member-text";
        const name = document.createElement("strong");
        name.textContent = n.display_name || n.username || "Someone";
        const sub = document.createElement("span");
        sub.textContent = (texts[n.kind] || "") + " · " + timeAgo(n.created_at);
        txt.append(name, sub);

        const del = gBtn("×", "nt-x", async e => {
            e.stopPropagation();
            const { error: er } = await supabaseClient.rpc("notif_delete", { p_id: n.id });
            if (er) { console.error(er); gToast("Could not delete it"); return; }
            row.remove();
            if (!box.querySelector(".notif-row")) empty();
            refreshBell();
        });
        row.append(av, txt, del);

        row.addEventListener("click", async () => {
            page.remove();
            if (n.kind === "dm_request") openRequests();
            else if (n.kind === "dm_accepted") {
                const { data: rs } = await supabaseClient.rpc("my_rooms");
                const room = (rs || []).find(r => String(r.id) === String(n.room_id));
                if (room) {
                    currentRoom = room;
                    currentUser = myProfile.username;
                    await loadDmMap();
                    openChat();
                }
            } else if (n.kind === "post_like" || n.kind === "post_comment") openPostPage(n.room_id, () => refreshBell());
            else if (n.kind === "story_like") showPage("profilePage");
            else if (n.username) openUserProfile(n.username);
        });
        box.appendChild(row);
    });

    await supabaseClient.rpc("mark_notifs_read");
    refreshBell();
}

// ---------- 9. Reactions: the usual 5 plus a "+" that opens every emoji ----------
const EMO_ALL = ("😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 😎 🤓 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🤭 🤫 😶 😐 😑 😬 🙄 😯 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤠 😈 👿 👹 💀 👻 👽 🤖 💩 🙈 🙉 🙊 " +
    "💋 💌 💘 💝 💖 💗 💓 💞 💕 💟 ❣️ 💔 ❤️ 🧡 💛 💚 💙 💜 🤎 🖤 🤍 💯 💢 💥 💫 💦 💨 🔥 ✨ ⭐ 🌟 🎉 🎊 🎈 🎁 " +
    "👍 👎 👌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 👋 🤝 🙏 👏 🙌 🫶 💪 🫡").split(" ");

function openEmojiPicker(onPick) {
    const body = csPanel("More reactions");
    const grid = gEl("div", "emo-grid");
    EMO_ALL.forEach(em => {
        const b = gEl("button", "emo-cell");
        b.type = "button";
        b.appendChild(makeEmojiImg(em));
        b.addEventListener("click", () => {
            const p = $("csPanel");
            if (p) p.remove();
            onPick(em);
        });
        grid.appendChild(b);
    });
    body.appendChild(grid);
}

function openMessageMenu(message, wrapper) {
    closeMessageMenu();
    const opened = Date.now();
    const menu = document.createElement("div");
    menu.className = "message-menu";

    REACTIONS.forEach(emoji => {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.emoji = emoji;
        b.appendChild(makeEmojiImg(emoji));
        b.addEventListener("click", e => {
            e.stopPropagation();
            if (Date.now() - opened < 350) return;   // ignore the release of the long press
            const removing = b.classList.contains("on");
            closeMessageMenu();
            sendReaction(message.id, emoji);
            if (removing) gToast("Reaction removed");
        });
        menu.appendChild(b);
    });

    const plus = document.createElement("button");
    plus.type = "button";
    plus.className = "emo-plus";
    plus.setAttribute("aria-label", "More reactions");
    plus.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
    plus.addEventListener("click", e => {
        e.stopPropagation();
        if (Date.now() - opened < 350) return;
        closeMessageMenu();
        openEmojiPicker(em => sendReaction(message.id, em));
    });
    menu.appendChild(plus);

    if (message.username === currentUser) {
        const del = document.createElement("button");
        del.type = "button";
        del.appendChild(makeEmojiImg("🗑️"));
        del.addEventListener("click", async e => {
            e.stopPropagation();
            if (Date.now() - opened < 350) return;
            closeMessageMenu();
            if (!confirm("Delete this message?")) return;
            const { data, error } = await supabaseClient.from("messages").delete().eq("id", message.id).select();
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

    const h = menu.offsetHeight || 52;
    let top = lastPress.y - h - 24;
    if (top < 76) top = lastPress.y + 36;
    top = Math.min(Math.max(top, 76), window.innerHeight - h - 16);
    menu.style.top = top + "px";

    // Highlight the reaction I already gave (tapping it again removes it)
    supabaseClient.from("messages").select("reactions").eq("id", message.id).maybeSingle().then(({ data }) => {
        const mine = data && data.reactions && data.reactions[currentUser];
        if (!mine) return;
        menu.querySelectorAll("button[data-emoji]").forEach(b => b.classList.toggle("on", b.dataset.emoji === mine));
    });

    const outside = e => { if (!menu.contains(e.target)) closeMessageMenu(); };
    const t = setTimeout(() => document.addEventListener("pointerdown", outside, true), 300);
    window.__menuOff = () => { clearTimeout(t); document.removeEventListener("pointerdown", outside, true); };
}

// Font rule: injected here so style.css stays untouched for it
(function () {
    const st = document.createElement("style");
    st.textContent = "html[data-font] body,html[data-font] button,html[data-font] input,html[data-font] textarea,html[data-font] select{font-family:var(--app-font) !important}";
    document.head.appendChild(st);
})();
// ================================
// FIXES v8: voice seats stored in the database, note bubbles, note sheet (full text + like)
// Paste at the very end of auth.js (below SOCIAL v7).
// ================================

// ---------- 1. Voice seats: one shared truth for every phone ----------
const SYNCS = { rows: [], room: null, busy: 0, tok: 0, fixing: false, timer: null, beat: null, ch: null };

function seatMine() {
    return vState ? (SYNCS.rows.find(r => r.username === vState.username) || null) : null;
}

function seatPing() {
    if (SYNCS.ch) { try { SYNCS.ch.send({ type: "broadcast", event: "seats", payload: {} }); } catch (e) {} }
}

function seatDropLocal() {
    if (!vState) return;
    vState.seat = null;
    vState.seatAt = 0;
    vState.muted = true;
    vState.hand = false;
    vState.allowed = false;
    vState.speaking = false;
    stopMic();
    vTrack();
}

async function seatsRefresh() {
    if (!vRoom || !vState) return;
    const rid = String(vRoom.id);
    const tok = ++SYNCS.tok;
    const { data, error } = await supabaseClient.rpc("seat_list", { p_room: rid });
    if (error) { console.error("seat_list", error); return; }
    // A newer refresh started, or the room was closed meanwhile: drop this result
    if (tok !== SYNCS.tok || !vRoom || !vState || String(vRoom.id) !== rid) return;
    SYNCS.rows = data || [];
    SYNCS.room = rid;

    if (SYNCS.busy === 0 && !SYNCS.fixing) {
        const count = vSeatCount();
        const mine = seatMine();
        if (mine) {
            if (vState.seat !== mine.seat) {
                vState.seat = mine.seat;
                vState.seatAt = new Date(mine.taken_at).getTime();
                vTrack();
            }
            if (mine.seat >= count) {
                // The layout got smaller and my seat does not exist any more: move to a free seat
                SYNCS.fixing = true;
                try {
                    const used = new Set(SYNCS.rows.map(r => r.seat));
                    let free = -1;
                    for (let i = 0; i < count; i++) { if (!used.has(i)) { free = i; break; } }
                    if (free >= 0) await takeSeat(free, true); else await leaveSeat();
                } finally { SYNCS.fixing = false; }
                return;
            }
        } else if (vState.seat !== null && vState.seat !== undefined) {
            // My seat is missing on the server (expired while the app slept): try to get it back first
            SYNCS.busy++;
            let back = false;
            try {
                const r = await supabaseClient.rpc("seat_take", { p_room: rid, p_seat: vState.seat });
                back = !!r.data;
            } catch (e) { console.error(e); }
            finally { SYNCS.busy--; }
            if (back) return seatsRefresh();
            seatDropLocal();
        }
    }
    renderVoice();
}

async function takeSeat(i, quiet) {
    if (!vRoom || !vState) return false;
    SYNCS.busy++;
    let ok = false, failed = false;
    try {
        const { data, error } = await supabaseClient.rpc("seat_take", { p_room: String(vRoom.id), p_seat: i });
        if (error) throw error;
        ok = !!data;
    } catch (e) { console.error("seat_take", e); failed = true; }
    finally { SYNCS.busy--; }

    if (ok && vState) {
        vState.seat = i;
        vState.seatAt = Date.now();
        vState.muted = true;
        vState.hand = false;
        vState.allowed = false;
        vTrack();
        seatPing();
    } else if (!quiet) {
        gToast(failed ? "Could not take the seat" : "That seat was just taken");
    }
    await seatsRefresh();
    return ok;
}

async function leaveSeat() {
    if (!vState) return;
    const had = vState.seat !== null && vState.seat !== undefined;
    const me = vState.username;
    seatDropLocal();
    SYNCS.rows = SYNCS.rows.filter(r => r.username !== me);
    renderVoice();
    if (had && vRoom) {
        SYNCS.busy++;
        try { await supabaseClient.rpc("seat_leave", { p_room: String(vRoom.id) }); }
        catch (e) { console.error(e); }
        finally { SYNCS.busy--; }
        seatPing();
        seatsRefresh();
    }
}

// Everyone else's seat now comes from the database; people missing from presence still appear
const _vUsers9 = vUsers;
vUsers = function () {
    const base = _vUsers9();
    if (!vRoom || !vState || SYNCS.room !== String(vRoom.id)) return base;
    const by = {};
    SYNCS.rows.forEach(r => { by[r.username] = r; });
    const out = base.map(u => {
        const r = by[u.username];
        return Object.assign({}, u, { seat: r ? r.seat : null, seatAt: r ? new Date(r.taken_at).getTime() : 0 });
    });
    const have = new Set(out.map(u => u.username));
    SYNCS.rows.forEach(r => {
        if (!have.has(r.username)) {
            out.push({
                username: r.username, name: r.display_name, avatar: r.avatar_url,
                seat: r.seat, seatAt: new Date(r.taken_at).getTime(),
                muted: true, hand: false, speaking: false, sid: null
            });
        }
    });
    return out;
};

// Hot Seat start: everybody sits down at the same moment, so retry when a seat was just taken
async function seatAuto() {
    for (let k = 0; k < 6; k++) {
        await seatsRefresh();
        if (!vState || !vRoom) return false;
        if (vState.seat !== null && vState.seat !== undefined) return true;
        const used = new Set(SYNCS.rows.map(r => r.seat));
        const free = [];
        for (let i = 0; i < vSeatCount(); i++) { if (!used.has(i)) free.push(i); }
        if (!free.length) { gToast("All seats are taken"); return false; }
        if (await takeSeat(free[Math.floor(Math.random() * free.length)], true)) return true;
    }
    return false;
}

function vhsEnter(s) {
    if (!vState || !vRoom) return;
    const me = vState.username;
    if (!(s.players || []).some(p => p.u === me)) return;
    const gp = $("gamesPage");
    if (gp && !gp.classList.contains("hidden")) {
        closeGames();
        gToast("Hot Seat has started!");
    }
    if (vState.seat === null || vState.seat === undefined) seatAuto();
}

function seatsStart() {
    seatsStop();
    if (!vRoom) return;
    const rid = String(vRoom.id);
    SYNCS.room = rid;
    SYNCS.rows = [];
    SYNCS.ch = supabaseClient.channel("vseat-" + rid, { config: { broadcast: { self: false } } })
        .on("broadcast", { event: "seats" }, () => seatsRefresh())
        .subscribe();
    SYNCS.timer = setInterval(() => { if (!document.hidden) seatsRefresh(); }, 3000);
    SYNCS.beat = setInterval(async () => {
        if (!vRoom || !vState || vState.seat === null || vState.seat === undefined) return;
        const { data, error } = await supabaseClient.rpc("seat_beat", { p_room: String(vRoom.id) });
        if (error) { console.error(error); return; }
        if (!data) seatsRefresh();   // the row expired: the refresh gets it back
    }, 15000);
    seatsRefresh();
}

function seatsStop() {
    clearInterval(SYNCS.timer);
    clearInterval(SYNCS.beat);
    SYNCS.timer = null;
    SYNCS.beat = null;
    if (SYNCS.ch) { supabaseClient.removeChannel(SYNCS.ch); SYNCS.ch = null; }
    SYNCS.rows = [];
    SYNCS.room = null;
    SYNCS.tok++;
}

document.addEventListener("visibilitychange", () => { if (!document.hidden && vRoom) seatsRefresh(); });

const _openVoiceRoom9 = openVoiceRoom;
openVoiceRoom = async function () {
    await _openVoiceRoom9.apply(this, arguments);
    try { seatsStart(); } catch (e) { console.error(e); }
};

const _closeVoice9 = closeVoice;
closeVoice = async function () {
    try {
        const rid = vRoom ? String(vRoom.id) : null;
        const seated = vState && vState.seat !== null && vState.seat !== undefined;
        seatsStop();
        if (rid && seated) await supabaseClient.rpc("seat_leave", { p_room: rid });
    } catch (e) { console.error(e); }
    return _closeVoice9.apply(this, arguments);
};

// ---------- 2. Notes in the Chats row: tap opens a sheet with the full note, like and reply ----------
const NS_HEART = '<svg viewBox="0 0 24 24"><path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z"/></svg>';

function nsLeft(iso) {
    const ms = new Date(iso).getTime() + 24 * 3600 * 1000 - Date.now();
    if (ms <= 0) return "expiring";
    const h = Math.floor(ms / 3600000);
    return h >= 1 ? h + "h left" : Math.max(1, Math.floor(ms / 60000)) + "m left";
}

function cnItem(o) {
    const it = gEl("div", "cn-item");
    if (o.note) {
        const c = PX_NOTE[pxIdx(o.note.color)];
        const b = gEl("div", "cn-bubble", o.note.body);
        b.style.background = c.bg;
        b.style.color = c.fg;
        it.appendChild(b);
    } else if (o.self) {
        it.appendChild(gEl("div", "cn-bubble ghost", "Note..."));
    }
    const av = gEl("div", "cn-av");
    paintAvatar(av, o.avatar, o.name);
    it.append(av, gEl("span", "cn-name", o.self ? "Your note" : o.name));
    it.addEventListener("click", () => {
        if (o.self && !o.note) { pxNoteEditor(null, cnRender); return; }
        cnOpen(o);
    });
    return it;
}

function cnOpen(o) {
    closeRoomActions();
    const back = gEl("div", "sheet-backdrop");
    const sheet = gEl("div", "sheet note-sheet");
    back.appendChild(sheet);
    back.addEventListener("click", e => { if (e.target === back) closeRoomActions(); });

    const top = gEl("div", "ns-top");
    const av = gEl("div", "ns-av");
    paintAvatar(av, o.avatar, o.name);
    top.append(av, gEl("strong", "", o.self ? "Your note" : o.name));
    sheet.appendChild(top);

    const col = PX_NOTE[pxIdx(o.note.color)];
    const card = gEl("div", "ns-note", o.note.body);
    card.style.background = col.bg;
    card.style.color = col.fg;
    sheet.append(card, gEl("div", "ns-when", timeAgo(o.note.created_at) + " · " + nsLeft(o.note.created_at)));

    const add = (label, fn, danger) => {
        const b = gEl("button", danger ? "danger" : "", label);
        b.type = "button";
        b.addEventListener("click", () => { closeRoomActions(); fn(); });
        sheet.appendChild(b);
    };

    const stateP = supabaseClient.rpc("note_state", { p_username: o.username });

    if (o.self) {
        const info = gEl("div", "ns-likes");
        sheet.appendChild(info);
        stateP.then(({ data }) => {
            const r = data && data[0];
            const n = r ? Number(r.likes) : 0;
            info.innerHTML = NS_HEART + "<span></span>";
            info.lastChild.textContent = n + (n === 1 ? " like" : " likes");
        });
        add("Leave a new note", () => pxNoteEditor(o.note, cnRender));
        add("Delete note", async () => {
            const { error } = await supabaseClient.from("profile_notes").delete().eq("user_id", authUser.id);
            if (error) { console.error(error); gToast("Could not delete the note"); return; }
            gToast("Note deleted");
            cnRender();
        }, true);
    } else {
        const like = gEl("button", "ns-like");
        like.type = "button";
        const paint = liked => {
            like.classList.toggle("on", !!liked);
            like.innerHTML = NS_HEART + "<span></span>";
            like.lastChild.textContent = liked ? "Liked" : "Like note";
        };
        paint(false);
        stateP.then(({ data }) => { const r = data && data[0]; paint(r && r.liked); });
        like.addEventListener("click", async () => {
            const { data, error } = await supabaseClient.rpc("note_like", { p_username: o.username });
            if (error) { console.error(error); gToast(error.message || "Could not like it"); return; }
            const r = data && data[0];
            if (r) paint(r.liked);
        });
        sheet.appendChild(like);
        add("Reply to note", async () => {
            const t = await pxAsk("Reply to " + o.name, "Reply...", 200);
            if (!t) return;
            try { await ixDmReply(o.username, o.name, "Note: " + o.note.body, t); gToast("Reply sent"); }
            catch (e) { console.error(e); gToast("Could not send the reply"); }
        });
        add("View profile", () => openUserProfile(o.username));
        add("Leave a note", () => pxNoteEditor(null, cnRender));
    }
    add("Cancel", () => {});
    document.body.appendChild(back);
}