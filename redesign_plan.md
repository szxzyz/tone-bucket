# Mission Page Redesign Plan

## UI Changes (Missions.tsx)
- Add Tabs at the top: **All**, **Channel**, **Mini-app**.
- Active tab style: Lime green background with black text (as per image).
- Add a prominent **+ Add Your Task** button below the tabs.
- Task cards should follow the style in the image:
  - Dark background, rounded corners.
  - Icon on the left.
  - Title and description.
  - Arrow icon on the right.
  - Stats at the bottom (Views, Reward in LTC/SWAG).
- Group tasks by category headers: **Bots & Mini-apps**, **Websites**, etc.

## Functional Changes
- Move task creation flow from `CreatePanel.tsx` (sheet) to a dedicated page `/tasks/create`.
- The new page should host the logic currently in `CreatePanel.tsx`.
- Remove legacy daily tasks (Adsgram check-in, Check for updates, Share with friends, Invite 1 friend) from the Missions page as requested.

## Technical Steps
1. Create `/home/ubuntu/vuuug/client/src/pages/CreateTask.tsx` by adapting `CreatePanel.tsx`.
2. Update `App.tsx` to include the new route.
3. Update `Missions.tsx` to:
   - Implement the new UI.
   - Link the "+ Add Your Task" button to `/tasks/create`.
   - Filter tasks based on selected tab.
   - Remove legacy daily mission sections.
4. Backend: Cleanup unused mission routes in `routes.ts` if they are no longer needed anywhere.

## Image References
- Lime green tab for "All".
- Black background cards.
- Bottom stats: eye icon for views, coin icon for reward.
