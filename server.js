const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// 메뉴 데이터 API (혹시 몰라 남겨둠)
const menuData = [
    { menu_id: 1, category_name: "주메뉴", menu_name: "흑돼지 김치찌개", description: "제주 흑돼지로 맛을 낸 깊고 진한 김치찌개", price: 10000, image_url: "https://images.unsplash.com/photo-1627308595229-7830a5c91f9f?w=300" },
    { menu_id: 2, category_name: "주메뉴", menu_name: "참치 김치찌개", description: "담백한 참치와 시원한 국물의 환상적인 조화", price: 10000, image_url: "https://images.unsplash.com/photo-1583394293214-28ded15ee548?w=300" },
    { menu_id: 3, category_name: "주메뉴", menu_name: "꽁치 김치찌개", description: "고소한 꽁치가 통째로 들어간 별미 찌개", price: 11000, image_url: "https://images.unsplash.com/photo-1547592166-23ac45744acd?w=300" },
    { menu_id: 4, category_name: "단품메뉴", menu_name: "왕 계란말이", description: "부드럽고 두툼하게 말아낸 인기 메뉴", price: 8000, image_url: "https://images.unsplash.com/photo-1518492104633-130d0cc84637?w=300" },
    { menu_id: 5, category_name: "단품메뉴", menu_name: "제육볶음", description: "매콤한 양념과 불향이 가득한 제육", price: 12000, image_url: "https://images.unsplash.com/photo-1563379926898-05f4575a45d8?w=300" },
    { menu_id: 6, category_name: "단품메뉴", menu_name: "오징어볶음", description: "탱글탱글한 오징어와 매운 양념의 만남", price: 13000, image_url: "https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?w=300" },
    { menu_id: 7, category_name: "사리추가", menu_name: "라면 사리", description: "찌개 국물과 환상궁합", price: 1500, image_url: "https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=300" },
    { menu_id: 8, category_name: "사리추가", menu_name: "두부 추가", description: "더 건강하고 고소하게", price: 2000, image_url: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=300" },
    { menu_id: 9, category_name: "사리추가", menu_name: "햄/소시지 사리", description: "부대찌개 느낌을 원한다면!", price: 3000, image_url: "https://images.unsplash.com/photo-1524182620194-8ec30319dfa4?w=300" },
    { menu_id: 10, category_name: "사리추가", menu_name: "당면 사리", description: "쫄깃한 식감을 더해줍니다", price: 1500, image_url: "https://images.unsplash.com/photo-1591814468924-caf88d1232e1?w=300" },
    { menu_id: 11, category_name: "사리추가", menu_name: "공기밥", description: "따끈한 쌀밥", price: 1000, image_url: "https://images.unsplash.com/photo-1516684732162-798a0062be99?w=300" }
];

app.get('/api/menu', (req, res) => {
    res.json({ success: true, data: menuData });
});

io.on('connection', (socket) => {
    socket.on('new_order', (data) => {
        io.emit('admin_order', data);
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});