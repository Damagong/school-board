c// 📦 필요한 모듈 불러오기
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// 💾 저장소 경로
const dataDir = path.join(__dirname, "data");
const usersPath = path.join(dataDir, "users.json");
const postsPath = path.join(dataDir, "posts.json");

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

// 📄 파일 불러오기 및 저장 함수
function loadJSON(filePath, fallback) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
        return fallback;
    }
}
function saveJSON(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

let users = loadJSON(usersPath, []);
let posts = loadJSON(postsPath, []);
let postIdCounter = posts.length > 0 ? Math.max(...posts.map(p => p.id)) + 1 : 1;

function saveUsers() {
    saveJSON(usersPath, users);
}
function savePosts() {
    saveJSON(postsPath, posts);
}

function isBanned(user) {
    return user.bannedUntil && new Date(user.bannedUntil) > new Date();
}

app.post("/register", (req, res) => {
    const { name, grade, password } = req.body;

    const exists = users.some(user => user.name === name);
    if (exists) return res.send("이미 존재하는 사용자입니다!");

    const isAdmin = users.length === 0;
    users.push({ name, grade, password, isAdmin, bannedUntil: null });
    saveData(); // 🔹 추가

    res.send(isAdmin ? "최초 관리자 계정이 생성되었습니다!" : "회원가입 완료!");
});

app.post("/login", (req, res) => {
    const { name, password } = req.body;
    const user = users.find(u => u.name === name && u.password === password);

    if (!user) return res.status(401).send("로그인 실패: 이름 또는 비밀번호가 틀렸습니다.");

    if (isBanned(user)) {
        return res.status(403).send(`로그인 금지: ${user.bannedUntil}까지 밴 상태입니다.`);
    }

    res.json({ name: user.name, grade: user.grade, isAdmin: user.isAdmin, bannedUntil: user.bannedUntil });
});

app.post("/post", (req, res) => {
    const { title, content, author, grade } = req.body; // ✅ 이 줄 먼저 있어야 함

    console.log("author:", author, "grade:", grade);    // ✅ 그 다음에 써야 됨
    console.log("현재 users:", users);

    const user = users.find(u => u.name === author && u.grade === grade);

    if (!user) return res.status(401).send("유저 정보가 유효하지 않습니다.");
    if (isBanned(user)) return res.status(403).send("밴된 유저는 글을 작성할 수 없습니다.");

    const newPost = {
        id: postIdCounter++,
        title,
        content,
        author,
        grade,
        likes: 0,
        dislikes: 0,
        voters: {},
        comments: [],
        pinned: false
    };

    posts.push(newPost);
    saveData(); // 🔹 추가
    res.send("글이 등록되었습니다!");
});

app.get("/posts", (req, res) => {
    const sorted = [...posts].sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return b.likes - a.likes; // 좋아요 많은 순
    });
    res.json(sorted);
});

app.post("/admin/ban", (req, res) => {
    const { requester, targetName, days } = req.body;

    const admin = users.find(u => u.name === requester && u.isAdmin);
    if (!admin) return res.status(403).send("권한이 없습니다.");

    const target = users.find(u => u.name === targetName);
    if (!target) return res.status(404).send("대상 유저를 찾을 수 없습니다.");

    if (days === 0) {
        target.bannedUntil = null;
        saveUsers(); // ✅ 저장
        return res.send(`${targetName}님의 밴이 해제되었습니다.`);
    }

    const until = new Date();
    until.setDate(until.getDate() + days);
    target.bannedUntil = until.toISOString();

    saveUsers(); // ✅ 저장
    res.send(`${targetName}님은 ${until.toISOString().split("T")[0]}까지 밴되었습니다.`);
});

app.post("/comment/:postId", (req, res) => {
    const { user, text } = req.body;
    const post = posts.find(p => p.id === parseInt(req.params.postId));
    const foundUser = users.find(u => u.name === user.name && u.grade === user.grade);

    if (!post) return res.status(404).send("게시글을 찾을 수 없습니다.");
    if (!foundUser || isBanned(foundUser)) return res.status(403).send("밴된 유저는 댓글을 달 수 없습니다.");

    const comment = {
        id: Date.now(),
        text,
        author: user.name,
        grade: user.grade,
        replies: []
    };

    post.comments.push(comment);
    saveData(); // 🔹 추가
    res.send("댓글 작성 완료!");
});

app.post("/vote/:id", (req, res) => {
    const postId = parseInt(req.params.id);
    const { user, voteType } = req.body;

    const foundUser = users.find(u => u.name === user.name && u.grade === user.grade);
    const post = posts.find(p => p.id === postId);

    if (!post) return res.status(404).send("글을 찾을 수 없습니다.");
    if (!foundUser || isBanned(foundUser)) return res.status(403).send("밴된 유저는 투표할 수 없습니다.");

    const previousVote = post.voters[user.name];
    if (previousVote) return res.status(400).send("이미 투표하셨습니다.");

    if (voteType === "like") post.likes += 1;
    else if (voteType === "dislike") post.dislikes += 1;

    post.voters[user.name] = voteType;
    saveData();
    res.send("투표 완료!");
});

app.post("/admin/pin/:postId", (req, res) => {
    const { requester, pinned } = req.body;
    const admin = users.find(u => u.name === requester && u.isAdmin);
    if (!admin) return res.status(403).send("관리자 권한이 없습니다.");

    const post = posts.find(p => p.id === parseInt(req.params.postId));
    if (!post) return res.status(404).send("게시글을 찾을 수 없습니다.");

    post.pinned = pinned;
    res.send(`게시글이 ${pinned ? "고정" : "고정 해제"}되었습니다.`);
});

app.delete("/post/:id", (req, res) => {
    const postId = parseInt(req.params.id);
    const user = req.body.user;

    const post = posts.find(p => p.id === postId);
    if (!post) return res.status(404).send("글을 찾을 수 없습니다.");

    const foundUser = users.find(u => u.name === user.name && u.grade === user.grade);
    if (!foundUser || (post.author !== user.name && !foundUser.isAdmin)) {
        return res.status(403).send("삭제 권한이 없습니다.");
    }

    posts = posts.filter(p => p.id !== postId);
    res.send("삭제 완료!");
});

app.put("/post/:id", (req, res) => {
    const postId = parseInt(req.params.id);
    const { title, content, user } = req.body;
    const post = posts.find(p => p.id === postId);

    if (!post) return res.status(404).send("글을 찾을 수 없습니다.");

    const foundUser = users.find(u => u.name === user.name && u.grade === user.grade);
    if (!foundUser || isBanned(foundUser)) return res.status(403).send("권한이 없습니다.");

    const isOwner = post.author === user.name && post.grade === user.grade;
    const isAdmin = foundUser.isAdmin;

    if (!isOwner && !isAdmin) return res.status(403).send("수정 권한이 없습니다.");

    post.title = title;
    post.content = content;
    res.send("수정 완료!");
});

app.post("/vote/:id", (req, res) => {
    const postId = parseInt(req.params.id);
    const { user, voteType } = req.body;

    const post = posts.find(p => p.id === postId);
    if (!post) return res.status(404).send("글을 찾을 수 없습니다.");

    const foundUser = users.find(u => u.name === user.name && u.grade === user.grade);
    if (!foundUser || isBanned(foundUser)) return res.status(403).send("밴된 유저는 투표할 수 없습니다.");

    const previousVote = post.voters?.[user.name];
    if (previousVote) return res.status(400).send("이미 투표하셨습니다.");

    if (!post.voters) post.voters = {};

    if (voteType === "like") post.likes = (post.likes || 0) + 1;
    else if (voteType === "dislike") post.dislikes = (post.dislikes || 0) + 1;

    post.voters[user.name] = voteType;
    res.send("투표 완료!");
});

app.post("/reply/:postId/:commentId", (req, res) => {
    const { user, text } = req.body;
    const post = posts.find(p => p.id === parseInt(req.params.postId));
    const comment = post?.comments.find(c => c.id === parseInt(req.params.commentId));
    const foundUser = users.find(u => u.name === user.name && u.grade === user.grade);
    if (!post || !comment) return res.status(404).send("댓글을 찾을 수 없습니다.");
    if (!foundUser || isBanned(foundUser)) return res.status(403).send("밴된 유저는 답글을 달 수 없습니다.");

    const reply = {
        id: Date.now(),
        text,
        author: user.name,
        grade: user.grade
    };
    comment.replies.push(reply);
    savePosts();
    res.send("답글이 등록되었습니다.");
});

app.delete("/comment/:postId/:commentId", (req, res) => {
    const { user } = req.body;
    const post = posts.find(p => p.id === parseInt(req.params.postId));
    const commentId = parseInt(req.params.commentId);
    const foundUser = users.find(u => u.name === user.name && u.grade === user.grade);
    if (!post || !foundUser || isBanned(foundUser)) return res.status(403).send("권한이 없습니다.");

    const comment = post.comments.find(c => c.id === commentId);
    if (!comment) return res.status(404).send("댓글을 찾을 수 없습니다.");

    const isOwner = comment.author === user.name && comment.grade === user.grade;
    const isAdmin = foundUser.isAdmin;

    if (!isOwner && !isAdmin) return res.status(403).send("삭제 권한이 없습니다.");

    post.comments = post.comments.filter(c => c.id !== commentId);
    savePosts();
    res.send("댓글 삭제 완료!");
});

// 서버 실행
app.listen(3000, () => {
    console.log("서버 실행됨: http://localhost:3000");
});

