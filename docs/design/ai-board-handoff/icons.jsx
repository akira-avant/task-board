/* Icon components — 1.5px stroke, lucide-style */
const Icon = ({ d, size = 16, fill = "none", stroke = "currentColor", sw = 1.6, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke}
       strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={style}>
    {d}
  </svg>
);

const IconFolder = (p) => <Icon {...p} d={<><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></>} />;
const IconProject = (p) => <Icon {...p} d={<><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 4v16"/></>} />;
const IconTeam = (p) => <Icon {...p} d={<><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="7" r="2.5"/><path d="M15 20a5 5 0 0 1 6-4.9"/></>} />;
const IconClient = (p) => <Icon {...p} d={<><path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-6h6v6"/></>} />;
const IconUser = (p) => <Icon {...p} d={<><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>} />;
const IconSearch = (p) => <Icon {...p} d={<><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></>} />;
const IconBell = (p) => <Icon {...p} d={<><path d="M6 8a6 6 0 1 1 12 0c0 5 2 7 2 7H4s2-2 2-7Z"/><path d="M10 19a2 2 0 0 0 4 0"/></>} />;
const IconHelp = (p) => <Icon {...p} d={<><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.8-2.5 2-2.5 4"/><circle cx="12" cy="17" r=".6" fill="currentColor"/></>} />;
const IconEdit = (p) => <Icon {...p} d={<><path d="M14 4 20 10 10 20H4v-6Z"/></>} />;
const IconUpload = (p) => <Icon {...p} d={<><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></>} />;
const IconPlus = (p) => <Icon {...p} d={<><path d="M12 5v14M5 12h14"/></>} />;
const IconSettings = (p) => <Icon {...p} d={<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/></>} />;
const IconFile = (p) => <Icon {...p} d={<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/></>} />;
const IconChev = (p) => <Icon {...p} d={<><path d="m9 6 6 6-6 6"/></>} />;
const IconArrowUp = (p) => <Icon {...p} sw={2} d={<><path d="m6 14 6-6 6 6"/></>} />;
const IconArrowDown = (p) => <Icon {...p} sw={2} d={<><path d="m6 10 6 6 6-6"/></>} />;
const IconX = (p) => <Icon {...p} d={<><path d="M6 6l12 12M18 6 6 18"/></>} />;
const IconCalendar = (p) => <Icon {...p} d={<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></>} />;
const IconFilter = (p) => <Icon {...p} d={<><path d="M3 5h18M6 12h12M10 19h4"/></>} />;
const IconDownload = (p) => <Icon {...p} d={<><path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/></>} />;
const IconSparkle = (p) => <Icon {...p} d={<><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></>} />;

window.Icons = {
  IconFolder, IconProject, IconTeam, IconClient, IconUser, IconSearch,
  IconBell, IconHelp, IconEdit, IconUpload, IconPlus, IconSettings,
  IconFile, IconChev, IconArrowUp, IconArrowDown, IconX, IconCalendar,
  IconFilter, IconDownload, IconSparkle
};
