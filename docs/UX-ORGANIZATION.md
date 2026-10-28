# Settings and Playbook organization

The settings navigation previously jumped around one document. General combined AI setup, search, images, market, theme, news, maps, icons, public records and updates. Playbook similarly put every major topic in one document. Both required scrolling through unrelated material to reach a specific task.

## Implemented structure

Settings opens one topic at a time:

| Group | Topics |
| --- | --- |
| Workspace | General; Profile & workflow; Company; Sending |
| AI & research | AI & models; Web search; Images; Data sources |
| Manage | Usage & budget; Data & backups |

General contains appearance, company icons and app updates. Other controls retain their existing save behavior in the relevant topic. Search matches setting names, descriptions, categories and common related terms. Each result shows its category and opens the setting directly. The index never includes saved values or credentials.

Existing links, including `#api-key`, `#ai-routing`, `#web-search`, `#public-data`, `#domain`, `#usage` and `#images`, select the appropriate topic. Browser Back and Forward restore the selected topic. Panels stay mounted to preserve unfinished forms. On narrow screens a grouped section picker replaces the secondary sidebar, and the search and picker remain accessible while scrolling.

Playbook retains its five sections and subsection links, showing one major section at a time. Review counts, editing, Ask, export, asset composition and consumer growth content remain available. The next-action button can open a different section. A topic picker on narrow screens reaches individual subsections.

## Product references

These are documented navigation patterns, reviewed through public product documentation rather than signed-in product audits. Mobbin returned a paid-plan restriction, so no Mobbin screens were used.

- [Linear workspace settings](https://linear.app/docs/workspaces): distinguishes personal/team preferences from administration. Applied here as explicit groups with named destinations, while retaining Inroad's own components and theme.
- [Linear preferences](https://linear.app/docs/account-preferences): organizes preferences around the relevant part of the workflow. Applied here by separating company, profile, appearance, providers and research sources.
- [Notion settings search](https://www.notion.com/help/workspace-settings): search results lead to the owning settings page and indicate where the setting lives. Applied here with a searchable settings index and category breadcrumbs.

## Review and verification

1. **Settings entry — improved.** the previous mixed General section is now three app preferences. Search and all topic destinations are visible in the secondary navigation.
2. **Find a setting — verified.** search for domain or backup, open the result, and return with browser history. The owning topic becomes visible and unrelated topics stay hidden.
3. **Narrow-screen settings — verified.** every topic is available through a labeled picker, with no horizontal page overflow at 390px and 850px.
4. **Playbook — improved and verified.** change major sections or open a saved subsection link. Cross-section destinations and consumer growth links reveal the appropriate content.

The browser regression checks cover those paths, unfinished connection input, asset composition links and no-result search recovery. They use the local sample workspace. Screenshots establish the visual organization; they do not establish full accessibility compliance or task-completion speed.

Validation: TypeScript and ESLint pass; 1,229 unit tests and seven browser navigation tests pass.

## Remaining opportunities

Integrations already collapses optional tools, and Research already separates Search, Connections, Monitors and Outcomes. A later pass can replace Integrations' introductory cards with shorter contextual links and add a searchable tool directory. Within Playbook, How we sell remains a substantial topic; its subsection links and mobile picker provide direct access without changing the strategy document's content.
