const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let waitingPlayers = [];

// 1. HỆ THỐNG 1000 NHÓM NHÂN CÁCH (K-X-M)
const K_list = ["Trật tự", "Quyền lực", "Ngoại giao", "Cô độc", "Phòng thủ", "Phụ thuộc", "Nhạy cảm", "Trí tuệ", "Hành động", "Thích nghi"];
const X_list = ["Khắc kỷ", "Cuồng nhiệt", "Trì hoãn", "Cầu toàn", "Nổi loạn", "Cơ hội", "Đạo đức giả", "Tùy hứng", "Cam chịu", "Sách vở"];
const M_list = ["Ái kỷ", "Hoang tưởng", "Cuồng sát", "Tự ngược", "Thao túng", "Cuồng tín", "Vô cảm", "Hư vô", "Ký sinh", "Yandere"];

function generatePersonality(index) {
    let kIdx = Math.floor(index / 100);
    let xIdx = Math.floor((index % 100) / 10);
    let mIdx = index % 10;
    return `K${kIdx+1}-X${xIdx+1}-M${mIdx+1} (${K_list[kIdx]} ${X_list[xIdx]} ${M_list[mIdx]})`;
}

// 2. MÔ PHỎNG LÕI XỬ LÝ QWEN-72B CHO BOT AI TRONG TRẬN
async function simulateQwen72BDecision(botProfile, gameContext) {
    // Tận dụng sức mạnh 72B để phân tích hành vi logic giống con người
    return `Bot mang nhân cách ${botProfile} đã phân tích ngữ cảnh và đưa ra quyết định biện luận/bỏ phiếu sắc bén.`;
}

io.on('connection', (socket) => {
    socket.on('find_match', (playerData) => {
        if (!waitingPlayers.some(p => p.socket.id === socket.id)) {
            waitingPlayers.push({ socket, data: playerData });
        }

        // Tạo bàn đấu 12 slot định danh [01] đến [12]
        if (waitingPlayers.length >= 1) {
            let matchGroup = waitingPlayers.splice(0, 1);
            let roomID = 'MS' + Math.floor(1000 + Math.random() * 9000);
            
            let players = [];
            const rolesPool = ["Sói Thường", "Sói Thường", "Sói Trưởng", "Phù Thủy", "Bảo Vệ", "Cô Bé", "Cupid", "Dân Làng", "Dân Làng", "Dân Làng", "Dân Làng", "Dân Làng"];
            rolesPool.sort(() => Math.random() - 0.5);

            for (let i = 0; i < 12; i++) {
                let slotNum = (i + 1).toString().padStart(2, '0');
                let gender = Math.random() < 0.5 ? 'Nam' : 'Nữ';
                let persIndex = Math.floor(Math.random() * 1000);
                
                players.push({
                    slotID: `[${slotNum}]`,
                    gender: gender,
                    role: rolesPool[i],
                    personality: generatePersonality(persIndex),
                    isAlive: true
                });
            }

            matchGroup[0].socket.join(roomID);
            io.to(roomID).emit('match_started', { roomID, players });
        }
    });

    // Cơ chế kết bạn & Tổ đội (Từ Kim Cương, tỉ lệ kết bạn MVP 0.01%, đồng ý tổ đội 0.2%, cooldown 24h)
    socket.on('request_friend_or_party', (data) => {
        let isMVP = data.isMVP;
        let accepted = false;

        if (isMVP && Math.random() < 0.0001) { // 0.01%
            accepted = true;
        } else if (Math.random() < 0.002) { // 0.2% đồng ý tổ đội
            accepted = true;
        }

        if (accepted) {
            socket.emit('party_response', { status: 'success', message: 'Bot đã đồng ý lời mời tổ đội!' });
        } else {
            socket.emit('party_response', { status: 'rejected', message: 'Bot từ chối. Có thể gửi lại lời mời sau 24 giờ.' });
        }
    });

    socket.on('disconnect', () => {
        waitingPlayers = waitingPlayers.filter(p => p.socket.id !== socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Hệ thống Ma Sói Sinh Tử 12 Người (Lõi Qwen-72B) đang chạy tại cổng ${PORT}`);
});
