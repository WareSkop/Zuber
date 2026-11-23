declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown';
  export const gfm: TurndownService.Plugin;
  export const tables: TurndownService.Plugin;
  export const strikethrough: TurndownService.Plugin;
  export const taskListItems: TurndownService.Plugin;
  const plugin: {
    gfm: TurndownService.Plugin;
    tables: TurndownService.Plugin;
    strikethrough: TurndownService.Plugin;
    taskListItems: TurndownService.Plugin;
  };
  export default plugin;
}
