-- Migration: Create admin_settings table to manage hardcoded parameters dynamically
CREATE TABLE IF NOT EXISTS admin_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Prepopulate metadata entries for dynamic mapping
INSERT INTO admin_settings (key, value) VALUES
('TELEGRAM_BOT_ID', '123456789'),
('TELEGRAM_BOT_USERNAME', 'example_bot'),
('TELEGRAM_BOT_URL', 'https://t.me/example_bot'),
('ADMIN_ID', '987654321'),
('CHANNEL_ID', '-1001111111111'),
('ANNOUNCEMENT_ID', '-1002222222222'),
('GROUP_ID', '-1003333333333'),
('CHANNEL_LINK', 'https://t.me/example_channel'),
('GROUP_LINK', 'https://t.me/example_group'),
('CHANNEL_NAME', 'Official Channel'),
('GROUP_NAME', 'Official Group'),
('ADSGRAM_POPUP_AD_BLOCK_ID', '0000'),
('ADSGRAM_REWARD_AD_BLOCK_ID', '1111'),
('DAILY_CHECK_IN_AD_ID', '2222'),
('MYSTERY_BOX_AD_ID', '3333'),
('SUPPORT_LINK', 'https://t.me/support_user'),
('WITHDRAW_GROUP_ID', '-1004444444444'),
('WITHDRAW_GROUP_LINK', 'https://t.me/withdraw_group')
ON CONFLICT (key) DO NOTHING;
