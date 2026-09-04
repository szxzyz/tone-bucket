# Gems Rebrand Plan

## Conversion Logic
- **10,000,000 Gems = 1 TON**
- Formula: `TON = Gems / 10,000,000`
- Previous logic: `10,000,000 SWAG = $1 USD` (This is being replaced)

## Navigation Updates
- **Home** -> **App** (Icon: `LayoutGrid`)
- **Earn** -> **Earn** (Icon: `Flame`)
- **Friends** -> **Social** (Icon: `Users`)
- **REWARD** -> **Market** (Icon: `Gift`)

## Key Replacements
- Global search and replace `SWAG` with `Gems` in all UI strings, backend logs, and notifications.
- Update `SWAG_PER_USD` or similar constants to reflect the new `GEMS_PER_TON` logic.
- Replace `SWAG` icon with a Gem icon (diamond or similar) in the header and other UI components.

## Affected Files
- `shared/schema.ts`: Database comments and default values.
- `server/tonPriceService.ts`: Core conversion logic.
- `server/routes.ts`: API endpoints, conversion routes, and notifications.
- `client/src/components/BottomNav.tsx`: Navigation names and icons.
- `client/src/components/Header.tsx`: Balance display.
- `client/src/pages/Withdraw.tsx`: Marketplace items and withdrawal flow.
- `client/src/hooks/useLanguage.tsx`: Translation strings.
