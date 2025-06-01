const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const uri = process.env.MONGODB_URI; // 여기에 MongoDB Atlas URI 입력
const client = new MongoClient(uri);
let usersCollection, postsCollection;

async function connectDB() {
    await client.connect();
    const db = client.db("schoolboard");
    usersCollection = db.collection("users");
    postsCollection = db.collection("posts");
}
connectDB();

function isBanned(user) {
    return user.bannedUntil && new Date(user.bannedUntil) > new Date();
}

// ✅ 회원가입
app.post("/register", async (req, res) => {
    const { name, grade, password } = req.body;
    const exists = await usersCollection.findOne({ name });
    if (exists) return res.send("이미 존재하는 사용자입니다!");
    const isAdmin = (await usersCollection.countDocuments()) === 0;
    await usersCollection.insertOne({ name, grade, password, isAdmin, bannedUntil: null });
    res.send(isAdmin ? "최초 관리자 계정이 생성되었습니다!" : "회원가입 완료!");
});

// ✅ 로그인
app.post("/login", async (req, res) => {
    const { name, password } = req.body;
    const user = await usersCollection.findOne({ name, password });
    if (!user) return res.status(401).send("로그인 실패: 이름 또는 비밀번호가 틀렸습니다.");
    if (isBanned(user)) return res.status(403).send(`로그인 금지: ${user.bannedUntil}까지 밴 상태입니다.`);
    res.json({ name: user.name, grade: user.grade, isAdmin: user.isAdmin, bannedUntil: user.bannedUntil });
});

// ✅ 글 작성
app.post("/post", async (req, res) => {
    const { title, content, author, grade } = req.body;
    const user = await usersCollection.findOne({ name: author, grade });
    if (!user || isBanned(user)) return res.status(403).send("유효하지 않거나 밴된 유저입니다.");

    const post = {
        title,
        content,
        author,
        grade,
        likes: 0,
        dislikes: 0,
        voters: {},
        comments: [],
        pinned: false,
        createdAt: new Date()
    };

    await postsCollection.insertOne(post);
    res.send("글이 등록되었습니다!");
});

// ✅ 글 목록
app.get("/posts", async (req, res) => {
    const posts = await postsCollection.find().sort({ pinned: -1, createdAt: -1 }).toArray();
    res.json(posts);
});

// ✅ 글 수정
app.put("/post/:id", async (req, res) => {
    const { title, content, user } = req.body;
    const post = await postsCollection.findOne({ _id: new ObjectId(req.params.id) });
    const foundUser = await usersCollection.findOne({ name: user.name, grade: user.grade });
    if (!post || !foundUser || isBanned(foundUser)) return res.status(403).send("수정 불가");

    const isOwner = post.author === user.name && post.grade === user.grade;
    const isAdmin = foundUser.isAdmin;
    if (!isOwner && !isAdmin) return res.status(403).send("권한 없음");

    await postsCollection.updateOne(
        { _id: post._id },
        { $set: { title, content } }
    );
    res.send("수정 완료!");
});

// ✅ 글 삭제
app.delete("/post/:id", async (req, res) => {
    const { user } = req.body;
    const post = await postsCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!post) return res.status(404).send("글이 없습니다.");

    const foundUser = await usersCollection.findOne({ name: user.name, grade: user.grade });
    const isOwner = post.author === user.name && post.grade === user.grade;
    const isAdmin = foundUser?.isAdmin;
    if (!isOwner && !isAdmin) return res.status(403).send("삭제 권한 없음");

    await postsCollection.deleteOne({ _id: post._id });
    res.send("삭제 완료!");
});

// ✅ 좋아요 / 싫어요
app.post("/vote/:id", async (req, res) => {
    const { user, voteType } = req.body;
    const post = await postsCollection.findOne({ _id: new ObjectId(req.params.id) });
    const foundUser = await usersCollection.findOne({ name: user.name, grade: user.grade });

    if (!post || !foundUser || isBanned(foundUser)) return res.status(403).send("투표 불가");
    if (post.voters?.[user.name]) return res.status(400).send("이미 투표하셨습니다.");

    const update = {
        [`voters.${user.name}`]: voteType,
        ...(voteType === "like" ? { likes: post.likes + 1 } : { dislikes: post.dislikes + 1 })
    };

    await postsCollection.updateOne({ _id: post._id }, { $set: update });
    res.send("투표 완료!");
});

// ✅ 댓글 작성
app.post("/comment/:postId", async (req, res) => {
    const { user, text } = req.body;
    const postId = new ObjectId(req.params.postId);
    const foundUser = await usersCollection.findOne({ name: user.name, grade: user.grade });
    if (!foundUser || isBanned(foundUser)) return res.status(403).send("댓글 작성 불가");

    const comment = {
        id: Date.now(),
        text,
        author: user.name,
        grade: user.grade,
        replies: []
    };

    await postsCollection.updateOne({ _id: postId }, { $push: { comments: comment } });
    res.send("댓글 작성 완료!");
});

// ✅ 답글 작성
app.post("/reply/:postId/:commentId", async (req, res) => {
    const { user, text } = req.body;
    const post = await postsCollection.findOne({ _id: new ObjectId(req.params.postId) });
    const foundUser = await usersCollection.findOne({ name: user.name, grade: user.grade });
    if (!post || !foundUser || isBanned(foundUser)) return res.status(403).send("답글 작성 불가");

    const comments = post.comments.map(c => {
        if (c.id === parseInt(req.params.commentId)) {
            c.replies.push({ id: Date.now(), text, author: user.name, grade: user.grade });
        }
        return c;
    });

    await postsCollection.updateOne({ _id: post._id }, { $set: { comments } });
    res.send("답글이 등록되었습니다.");
});

// ✅ 글 고정
app.post("/admin/pin/:postId", async (req, res) => {
    const { requester } = req.body;
    const admin = await usersCollection.findOne({ name: requester, isAdmin: true });
    if (!admin) return res.status(403).send("관리자만 사용 가능");

    await postsCollection.updateOne(
        { _id: new ObjectId(req.params.postId) },
        [{ $set: { pinned: { $not: "$pinned" } } }]
    );
    res.send("고정 상태 변경됨");
});

// ✅ 밴 기능
app.post("/admin/ban", async (req, res) => {
    const { requester, targetName, days } = req.body;
    const admin = await usersCollection.findOne({ name: requester, isAdmin: true });
    if (!admin) return res.status(403).send("권한 없음");

    const until = new Date();
    until.setDate(until.getDate() + days);

    await usersCollection.updateOne(
        { name: targetName },
        { $set: { bannedUntil: days === 0 ? null : until.toISOString() } }
    );

    res.send(days === 0 ? `${targetName}님의 밴이 해제되었습니다.` : `${targetName}님은 ${until.toISOString().split("T")[0]}까지 밴되었습니다.`);
});

// ✅ 서버 실행
app.listen(3000, () => {
    console.log("서버 실행됨: http://localhost:3000");
});
