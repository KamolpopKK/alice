// คำพูดของ Alice ที่อนุมัติแล้ว — ที่เดียวในโค้ด; component รับ key ไม่รับข้อความเอง
// รูปแบบนี้ตั้งใจให้ localization ในอนาคตแทนค่าได้โดยไม่ต้องแก้จุดที่เรียกใช้

export const ALICE_COPY = {
  login: 'Welcome back. Everything’s ready for you.',
  setup: 'Let’s get your workspace in order.',
  invite: 'Welcome in. Let’s get you settled.',
  myTasksEmpty: 'All tidy. Nothing needs your attention right now.',
  projectsEmpty: 'No projects yet. Start one, and I’ll help keep things organized.',
  documentsEmpty: 'No documents yet. Add one when you’re ready.',
  notFound: 'I couldn’t find that page. Let’s head back somewhere familiar.',
  fullPageError: 'Something slipped out of place. Let’s try that again.',
} as const

export type AliceCopyKey = keyof typeof ALICE_COPY

export function aliceSays(key: AliceCopyKey): string {
  return ALICE_COPY[key]
}
