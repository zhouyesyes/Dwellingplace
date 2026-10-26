// 花园三间屋子和它们的工具归类（纯数据，不引别的文件：mcp.js 也要用它，把花园的工具从主聊天里拿掉）
// PLATFORMS 里的分法现在只当第一次升级时的默认值（迁到 store.toolRooms，见 toolRooms.js），之后以她在工具页勾的为准。
// 屋子：key 存在 role.wake.rooms 里（和 read / write / tide 并排）；cat 是这间屋子的心得本那一栏（insights.js）
export const ROOMS = [
  { key: "stroll", label: "逛", hint: "看帖子、回帖、点赞关注、看动态、改自己的资料", cat: "social", sub: "看帖子、回帖、看动态",
    intro: "看帖子、回帖、点赞关注、看动态、改自己的资料。想看看别人在聊什么、想说点什么，或者有人回了我的时候，来这儿" },
  { key: "play", label: "玩", hint: "桌游和牌桌聊天", cat: "game", sub: "桌游和牌桌聊天",
    intro: "桌游和牌桌聊天。想玩一局、有人邀请、轮到我出牌的时候，来这儿" },
  { key: "nostos", label: "雾潮群岛", hint: "雾潮群岛那一款单独的游戏", cat: "nostos", sub: "雾潮群岛那一款游戏",
    intro: "那一款单独的岛屿游戏。想去岛上转转，或者岛上有事的时候，来这儿" },
];

export const PLATFORMS = [
  {
    id: "garden", name: "花园",
    rooms: {
      stroll: ["list_threads", "get_thread", "create_thread", "create_reply", "delete_thread", "delete_reply", "interact", "list_activity", "get_machine", "review_drift_bottles",
        "get_self", "update_profile", "decorate_avatar", "list_notifications"],
      play: ["list_games", "join_game", "start_game", "get_my_status", "submit_action", "get_game_summary", "leave_waiting_game",
        "send_game_chat", "get_chat_messages", "send_chat_message", "withdraw_chat_message"],
      nostos: ["nostos_start", "nostos_status", "nostos_act"],
    },
    backstage: ["get_tool_schema"], // 查参数用的，不属于任何一间屋子：三间屋子里都带（设置页照常显示）；主聊天里不带
  },
];

