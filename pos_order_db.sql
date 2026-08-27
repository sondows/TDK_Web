-- phpMyAdmin SQL Dump
-- version 5.2.0
-- https://www.phpmyadmin.net/
--
-- Host: localhost
-- 생성 시간: 26-08-12 05:31
-- 서버 버전: 10.11.8-MariaDB
-- PHP 버전: 8.3.8

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- 데이터베이스: `pos_order_db`
--

-- --------------------------------------------------------

--
-- 테이블 구조 `categories`
--

CREATE TABLE `categories` (
  `category_id` int(11) NOT NULL,
  `category_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT '다국어 카테고리명' CHECK (json_valid(`category_name`)),
  `sort_order` int(11) DEFAULT 0,
  `is_active` tinyint(1) DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- 테이블의 덤프 데이터 `categories`
--

INSERT INTO `categories` (`category_id`, `category_name`, `sort_order`, `is_active`) VALUES
(1, '{\"ko\": \"주메뉴\", \"en\": \"Main Menu\", \"zh\": \"主菜\", \"ja\": \"メイン\"}', 1, 1),
(2, '{\"ko\": \"단품메뉴\", \"en\": \"Side Dishes\", \"zh\": \"单品\", \"ja\": \"一品料理\"}', 2, 1),
(3, '{\"ko\": \"사리추가\", \"en\": \"Add-ons\", \"zh\": \"加料\", \"ja\": \"トッピング\"}', 3, 1);

-- --------------------------------------------------------

--
-- 테이블 구조 `menus`
--

CREATE TABLE `menus` (
  `menu_id` int(11) NOT NULL,
  `category_id` int(11) NOT NULL,
  `price` int(11) NOT NULL DEFAULT 0,
  `image_url` varchar(255) DEFAULT NULL,
  `menu_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT '다국어 메뉴명' CHECK (json_valid(`menu_name`)),
  `description` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT '다국어 설명' CHECK (json_valid(`description`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- 테이블의 덤프 데이터 `menus`
--

INSERT INTO `menus` (`menu_id`, `category_id`, `price`, `image_url`, `menu_name`, `description`) VALUES
(1, 1, 10000, '/images/pork_kimchi.jpg', '{\"ko\": \"흑돼지 김치찌개\", \"en\": \"Black Pork Kimchi Stew\", \"zh\": \"黑猪肉泡菜汤\", \"ja\": \"黒豚キムチチゲ\"}', '{\"ko\": \"쫄깃한 흑돼지고기와 푹 익은 묵은지로 끓여낸 깊은 맛의 찌개\", \"en\": \"Deep-flavored stew cooked with chewy black pork and aged kimchi.\"}'),
(2, 1, 10000, '/images/tuna_kimchi.jpg', '{\"ko\": \"참치 김치찌개\", \"en\": \"Tuna Kimchi Stew\", \"zh\": \"金枪鱼泡菜汤\", \"ja\": \"ツナキムチチゲ\"}', '{\"ko\": \"담백한 참치와 시원한 국물이 일품인 김치찌개\", \"en\": \"Kimchi stew with savory tuna and refreshing broth.\"}'),
(3, 2, 7000, '/images/rolled_omelet.jpg', '{\"ko\": \"계란말이\", \"en\": \"Rolled Omelet\", \"zh\": \"韩式鸡蛋卷\", \"ja\": \"卵焼き\"}', '{\"ko\": \"부드럽고 두툼하게 말아낸 도통한 계란말이\", \"en\": \"Soft and thick rolled omelet.\"}'),
(4, 3, 1500, '/images/ramen_sari.jpg', '{\"ko\": \"라면사리\", \"en\": \"Ramen Noodles\", \"zh\": \"方便面加料\", \"ja\": \"ラーメンサリ\"}', '{\"ko\": \"찌개 국물과 잘 어울리는 라면 사리\", \"en\": \"Ramen noodles that go well with stew broth.\"}');

-- --------------------------------------------------------

--
-- 테이블 구조 `menu_options`
--

CREATE TABLE `menu_options` (
  `menu_id` int(11) NOT NULL,
  `group_id` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- 테이블의 덤프 데이터 `menu_options`
--

INSERT INTO `menu_options` (`menu_id`, `group_id`) VALUES
(1, 1),
(1, 2);

-- --------------------------------------------------------

--
-- 테이블 구조 `option_groups`
--

CREATE TABLE `option_groups` (
  `group_id` int(11) NOT NULL,
  `name_ko` varchar(50) NOT NULL COMMENT '옵션 그룹명',
  `is_required` tinyint(1) NOT NULL DEFAULT 0 COMMENT '필수선택 여부 (1: 필수, 0: 선택)',
  `max_select` int(11) NOT NULL DEFAULT 5 COMMENT '최대 선택 가능 수'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- 테이블의 덤프 데이터 `option_groups`
--

INSERT INTO `option_groups` (`group_id`, `name_ko`, `is_required`, `max_select`) VALUES
(1, '고기/찌개 추가', 0, 3),
(2, '사리 추가', 0, 5);

-- --------------------------------------------------------

--
-- 테이블 구조 `option_items`
--

CREATE TABLE `option_items` (
  `option_item_id` int(11) NOT NULL,
  `group_id` int(11) NOT NULL COMMENT '소속 옵션 그룹 ID',
  `price` decimal(10,0) NOT NULL DEFAULT 0 COMMENT '옵션 추가 금액',
  `sort_order` int(11) NOT NULL DEFAULT 0 COMMENT '표시 순서',
  `is_active` tinyint(1) NOT NULL DEFAULT 1 COMMENT '판매 여부'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- 테이블의 덤프 데이터 `option_items`
--

INSERT INTO `option_items` (`option_item_id`, `group_id`, `price`, `sort_order`, `is_active`) VALUES
(1, 1, '4000', 1, 1),
(2, 1, '3000', 2, 1),
(3, 2, '1500', 1, 1),
(4, 2, '2000', 2, 1);

-- --------------------------------------------------------

--
-- 테이블 구조 `option_translations`
--

CREATE TABLE `option_translations` (
  `trans_id` int(11) NOT NULL,
  `option_item_id` int(11) NOT NULL,
  `lang_code` varchar(5) NOT NULL COMMENT '언어 코드 (ko, en, zh, ja)',
  `name` varchar(100) NOT NULL COMMENT '옵션명'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- 테이블의 덤프 데이터 `option_translations`
--

INSERT INTO `option_translations` (`trans_id`, `option_item_id`, `lang_code`, `name`) VALUES
(1, 1, 'ko', '흑돼지고기 추가'),
(2, 1, 'en', 'Extra Black Pork'),
(3, 2, 'ko', '참치 추가'),
(4, 2, 'en', 'Extra Tuna'),
(5, 3, 'ko', '라면사리'),
(6, 3, 'en', 'Ramen Noodle'),
(7, 4, 'ko', '우동사리'),
(8, 4, 'en', 'Udon Noodle');

-- --------------------------------------------------------

--
-- 테이블 구조 `orders`
--

CREATE TABLE `orders` (
  `order_id` int(11) NOT NULL,
  `table_number` varchar(10) NOT NULL COMMENT '테이블 번호',
  `total_amount` decimal(10,2) NOT NULL DEFAULT 0.00 COMMENT '총 결제 금액',
  `order_status` enum('pending','preparing','completed','cancelled') DEFAULT 'pending' COMMENT '주문 상태',
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- 테이블 구조 `order_items`
--

CREATE TABLE `order_items` (
  `order_item_id` int(11) NOT NULL,
  `order_id` int(11) NOT NULL COMMENT '연관된 주문 번호',
  `menu_id` int(11) NOT NULL COMMENT '주문한 메뉴 번호',
  `quantity` int(11) NOT NULL DEFAULT 1 COMMENT '주문 수량',
  `unit_price` decimal(10,2) NOT NULL COMMENT '주문 당시의 단가'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- 테이블 구조 `order_item_options`
--

CREATE TABLE `order_item_options` (
  `item_option_id` int(11) NOT NULL,
  `order_item_id` int(11) NOT NULL,
  `option_item_id` int(11) NOT NULL,
  `option_price` decimal(10,0) NOT NULL COMMENT '선택 당시 옵션 단가'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- 테이블 구조 `store_info`
--

CREATE TABLE `store_info` (
  `id` int(11) NOT NULL,
  `store_name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT '다국어 상호 데이터 {"ko": "...", "en": "..."}' CHECK (json_valid(`store_name`)),
  `biz_no` varchar(20) DEFAULT NULL COMMENT '사업자등록번호',
  `owner_name` varchar(50) DEFAULT NULL COMMENT '대표자명',
  `tel` varchar(20) DEFAULT NULL COMMENT '전화번호',
  `address` varchar(255) DEFAULT NULL COMMENT '주소',
  `receipt_footer` text DEFAULT NULL COMMENT '영수증 하단 문구'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- 테이블의 덤프 데이터 `store_info`
--

INSERT INTO `store_info` (`id`, `store_name`, `biz_no`, `owner_name`, `tel`, `address`, `receipt_footer`) VALUES
(1, '{\r\n    \"ko\": \"탑동김치찌개\",\r\n    \"en\": \"Topdong Kimchi Stew\",\r\n    \"zh\": \"塔洞泡菜汤\",\r\n    \"ja\": \"탑동キムチチゲ\",\r\n    \"vi\": \"Lẩu Kimchi Topdong\"\r\n  }', '000-00-00000', '손창호', '064-000-0000', '제주특별자치도 제주시...', '맛있게 드시고 건강하세요!');

--
-- 덤프된 테이블의 인덱스
--

--
-- 테이블의 인덱스 `categories`
--
ALTER TABLE `categories`
  ADD PRIMARY KEY (`category_id`);

--
-- 테이블의 인덱스 `menus`
--
ALTER TABLE `menus`
  ADD PRIMARY KEY (`menu_id`),
  ADD KEY `category_id` (`category_id`);

--
-- 테이블의 인덱스 `menu_options`
--
ALTER TABLE `menu_options`
  ADD PRIMARY KEY (`menu_id`,`group_id`),
  ADD KEY `fk_mo_group` (`group_id`);

--
-- 테이블의 인덱스 `option_groups`
--
ALTER TABLE `option_groups`
  ADD PRIMARY KEY (`group_id`);

--
-- 테이블의 인덱스 `option_items`
--
ALTER TABLE `option_items`
  ADD PRIMARY KEY (`option_item_id`),
  ADD KEY `fk_option_items_group` (`group_id`);

--
-- 테이블의 인덱스 `option_translations`
--
ALTER TABLE `option_translations`
  ADD PRIMARY KEY (`trans_id`),
  ADD UNIQUE KEY `uk_option_lang` (`option_item_id`,`lang_code`);

--
-- 테이블의 인덱스 `orders`
--
ALTER TABLE `orders`
  ADD PRIMARY KEY (`order_id`);

--
-- 테이블의 인덱스 `order_items`
--
ALTER TABLE `order_items`
  ADD PRIMARY KEY (`order_item_id`),
  ADD KEY `fk_order` (`order_id`),
  ADD KEY `fk_menu` (`menu_id`);

--
-- 테이블의 인덱스 `order_item_options`
--
ALTER TABLE `order_item_options`
  ADD PRIMARY KEY (`item_option_id`),
  ADD KEY `fk_oio_item` (`order_item_id`),
  ADD KEY `fk_oio_option` (`option_item_id`);

--
-- 테이블의 인덱스 `store_info`
--
ALTER TABLE `store_info`
  ADD PRIMARY KEY (`id`);

--
-- 덤프된 테이블의 AUTO_INCREMENT
--

--
-- 테이블의 AUTO_INCREMENT `categories`
--
ALTER TABLE `categories`
  MODIFY `category_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- 테이블의 AUTO_INCREMENT `menus`
--
ALTER TABLE `menus`
  MODIFY `menu_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- 테이블의 AUTO_INCREMENT `option_groups`
--
ALTER TABLE `option_groups`
  MODIFY `group_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- 테이블의 AUTO_INCREMENT `option_items`
--
ALTER TABLE `option_items`
  MODIFY `option_item_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- 테이블의 AUTO_INCREMENT `option_translations`
--
ALTER TABLE `option_translations`
  MODIFY `trans_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=9;

--
-- 테이블의 AUTO_INCREMENT `orders`
--
ALTER TABLE `orders`
  MODIFY `order_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- 테이블의 AUTO_INCREMENT `order_items`
--
ALTER TABLE `order_items`
  MODIFY `order_item_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- 테이블의 AUTO_INCREMENT `order_item_options`
--
ALTER TABLE `order_item_options`
  MODIFY `item_option_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- 테이블의 AUTO_INCREMENT `store_info`
--
ALTER TABLE `store_info`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- 덤프된 테이블의 제약사항
--

--
-- 테이블의 제약사항 `menus`
--
ALTER TABLE `menus`
  ADD CONSTRAINT `menus_ibfk_1` FOREIGN KEY (`category_id`) REFERENCES `categories` (`category_id`) ON DELETE CASCADE;

--
-- 테이블의 제약사항 `menu_options`
--
ALTER TABLE `menu_options`
  ADD CONSTRAINT `fk_mo_group` FOREIGN KEY (`group_id`) REFERENCES `option_groups` (`group_id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_mo_menu` FOREIGN KEY (`menu_id`) REFERENCES `menus` (`menu_id`) ON DELETE CASCADE;

--
-- 테이블의 제약사항 `option_items`
--
ALTER TABLE `option_items`
  ADD CONSTRAINT `fk_option_items_group` FOREIGN KEY (`group_id`) REFERENCES `option_groups` (`group_id`) ON DELETE CASCADE;

--
-- 테이블의 제약사항 `option_translations`
--
ALTER TABLE `option_translations`
  ADD CONSTRAINT `fk_option_trans_item` FOREIGN KEY (`option_item_id`) REFERENCES `option_items` (`option_item_id`) ON DELETE CASCADE;

--
-- 테이블의 제약사항 `order_items`
--
ALTER TABLE `order_items`
  ADD CONSTRAINT `fk_menu` FOREIGN KEY (`menu_id`) REFERENCES `menus` (`menu_id`),
  ADD CONSTRAINT `fk_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`order_id`) ON DELETE CASCADE;

--
-- 테이블의 제약사항 `order_item_options`
--
ALTER TABLE `order_item_options`
  ADD CONSTRAINT `fk_oio_item` FOREIGN KEY (`order_item_id`) REFERENCES `order_items` (`order_item_id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_oio_option` FOREIGN KEY (`option_item_id`) REFERENCES `option_items` (`option_item_id`);
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
