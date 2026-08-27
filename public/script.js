// 데이터를 전역 변수로 즉시 선언하여 지연 방지
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

let cart = [];
let socket;

try {
    socket = io();
} catch (e) {
    console.error("소켓 연결 실패:", e);
}

document.addEventListener('DOMContentLoaded', () => {
    renderAll();
    window.addEventListener('scroll', handleScrollSpy);
});

function renderAll() {
    const tabs = document.getElementById('tabs');
    const container = document.getElementById('menuContainer');
    const categories = ["주메뉴", "단품메뉴", "사리추가"];

    // 탭 렌더링
    tabs.innerHTML = categories.map((cat, idx) => `
        <div class="tab-item ${idx === 0 ? 'active' : ''}" id="tab-${cat}" onclick="scrollToCategory('${cat}')">${cat}</div>
    `).join('');

    // 메뉴 섹션 렌더링
    container.innerHTML = categories.map(cat => {
        const items = menuData.filter(m => m.category_name === cat);
        return `
            <section id="section-${cat}" class="category-section">
                <h2 class="section-title">${cat}</h2>
                ${items.map(item => `
                    <div class="menu-card" onclick="addToCart(${item.menu_id})">
                        <div class="menu-info">
                            <div class="menu-name">${item.menu_name}</div>
                            <div class="menu-desc">${item.description}</div>
                            <div class="menu-price">${item.price.toLocaleString()}원</div>
                        </div>
                        <img src="${item.image_url}" class="menu-img" onerror="this.src='https://via.placeholder.com/100'">
                    </div>
                `).join('')}
            </section>
        `;
    }).join('');
}

function scrollToCategory(cat) {
    const section = document.getElementById(`section-${cat}`);
    if (section) {
        const offset = 105;
        const bodyRect = document.body.getBoundingClientRect().top;
        const elementRect = section.getBoundingClientRect().top;
        const offsetPosition = (elementRect - bodyRect) - offset;
        window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
    }
}

function handleScrollSpy() {
    const sections = document.querySelectorAll('.category-section');
    const tabs = document.querySelectorAll('.tab-item');
    let current = "주메뉴";

    sections.forEach(section => {
        const sectionTop = section.offsetTop;
        if (window.pageYOffset >= sectionTop - 120) {
            current = section.getAttribute('id').replace('section-', '');
        }
    });

    tabs.forEach(tab => {
        tab.classList.toggle('active', tab.id === `tab-${current}`);
    });
}

function addToCart(id) {
    const item = menuData.find(m => m.menu_id === id);
    if(item) {
        cart.push(item);
        updateCartUI();
    }
}

function updateCartUI() {
    const total = cart.reduce((sum, item) => sum + item.price, 0);
    document.getElementById('totalPrice').innerText = total.toLocaleString() + '원';
    document.getElementById('cartCount').innerText = cart.length;
}

function submitOrder() {
    if(cart.length === 0) return alert("메뉴를 담아주세요!");
    if(socket) socket.emit('new_order', { table: 1, items: cart });
    alert("주문이 성공적으로 접수되었습니다!");
    cart = [];
    updateCartUI();
}