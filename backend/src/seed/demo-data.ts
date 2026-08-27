/**
 * The demonstration data set — US-120.
 *
 * Content only: no Prisma, no side effects. `demo-seed.ts` turns this into rows.
 * Separating them means the thing a reviewer actually needs to read — do these
 * tickets sound like real support cases? — is one file with no plumbing in it.
 *
 * **Everything here is fiction.** Names, companies, order numbers and amounts
 * are invented. Nothing is copied from a real customer.
 */
import type { CreateSlaPolicy } from '@crm/shared';

export interface DemoBranch {
  code: string;
  nameEn: string;
  nameAr: string;
  timezone: string;
}

export interface DemoDepartment {
  code: string;
  nameEn: string;
  nameAr: string;
  branch: string;
}

export interface DemoCategory {
  slug: string;
  nameEn: string;
  nameAr: string;
  department: string;
  defaultPriority?: CreateSlaPolicy['priority'];
}

export interface DemoUser {
  email: string;
  firstName: string;
  lastName: string;
  role: 'administrator' | 'manager' | 'agent';
  department: string;
  branch: string;
  locale: 'EN' | 'AR';
}

export interface DemoCustomer {
  key: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  companyName?: string;
  type: 'INDIVIDUAL' | 'COMPANY';
  isVip: boolean;
  locale: 'EN' | 'AR';
  branch: string;
}

export interface DemoMessage {
  from: 'CUSTOMER' | 'AGENT' | 'SYSTEM';
  /** An internal note. Never reaches the customer — the project's first rule. */
  isInternal?: boolean;
  body: string;
  /** Minutes after the ticket was created. */
  after: number;
  attachments?: { fileName: string; contentType: string; sizeBytes: number }[];
}

export interface DemoTicket {
  subject: string;
  description: string;
  status: 'NEW' | 'WAITING_FOR_AGENT' | 'WAITING_FOR_CUSTOMER' | 'RESOLVED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  channel: 'EMAIL' | 'WHATSAPP' | 'CHAT' | 'SMS' | 'WEB';
  customer: string;
  /** An agent's email, or null — an unassigned ticket is AC4's first edge case. */
  assignee: string | null;
  category: string;
  /** How long ago the ticket was opened. Drives the SLA state. */
  hoursAgo: number;
  tags: string[];
  messages: DemoMessage[];
  tasks?: { title: string; status: 'TODO' | 'IN_PROGRESS' | 'DONE' }[];
  /** Mark tickets that should be seeded with escalation data. */
  escalated?: boolean;
}

export interface DemoArticle {
  translationGroup: string;
  locale: 'EN' | 'AR';
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  category: string;
  status: 'PUBLISHED' | 'DRAFT';
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

export const DEMO_BRANCHES: readonly DemoBranch[] = [
  { code: 'RUH', nameEn: 'Riyadh', nameAr: 'الرياض', timezone: 'Asia/Riyadh' },
  { code: 'JED', nameEn: 'Jeddah', nameAr: 'جدة', timezone: 'Asia/Riyadh' },
];

export const DEMO_DEPARTMENTS: readonly DemoDepartment[] = [
  { code: 'SUP', nameEn: 'Customer Support', nameAr: 'دعم العملاء', branch: 'RUH' },
  { code: 'BIL', nameEn: 'Billing', nameAr: 'الفوترة', branch: 'RUH' },
  { code: 'TEC', nameEn: 'Technical', nameAr: 'الدعم الفني', branch: 'JED' },
];

export const DEMO_CATEGORIES: readonly DemoCategory[] = [
  { slug: 'billing-invoice', nameEn: 'Invoices', nameAr: 'الفواتير', department: 'BIL' },
  {
    slug: 'billing-refund',
    nameEn: 'Refunds',
    nameAr: 'المبالغ المستردة',
    department: 'BIL',
    defaultPriority: 'HIGH',
  },
  { slug: 'account-access', nameEn: 'Account access', nameAr: 'الدخول للحساب', department: 'SUP' },
  { slug: 'delivery', nameEn: 'Delivery', nameAr: 'التوصيل', department: 'SUP' },
  {
    slug: 'technical-outage',
    nameEn: 'Service outage',
    nameAr: 'انقطاع الخدمة',
    department: 'TEC',
    defaultPriority: 'URGENT',
  },
  { slug: 'technical-integration', nameEn: 'Integrations', nameAr: 'التكامل', department: 'TEC' },
];

/**
 * Staff beyond the four generic development accounts.
 *
 * AC1 wants users across every role, and a queue with one agent in it does not
 * demonstrate assignment, workload or scope. Two agents per department is the
 * smallest number that makes "reassign to a colleague" a real action.
 */
export const DEMO_USERS: readonly DemoUser[] = [
  {
    email: 'nadia.saleh@crm.local',
    firstName: 'Nadia',
    lastName: 'Saleh',
    role: 'agent',
    department: 'SUP',
    branch: 'RUH',
    locale: 'AR',
  },
  {
    email: 'tom.becker@crm.local',
    firstName: 'Tom',
    lastName: 'Becker',
    role: 'agent',
    department: 'SUP',
    branch: 'RUH',
    locale: 'EN',
  },
  {
    email: 'huda.mansour@crm.local',
    firstName: 'Huda',
    lastName: 'Mansour',
    role: 'agent',
    department: 'BIL',
    branch: 'RUH',
    locale: 'AR',
  },
  {
    email: 'priya.raman@crm.local',
    firstName: 'Priya',
    lastName: 'Raman',
    role: 'agent',
    department: 'TEC',
    branch: 'JED',
    locale: 'EN',
  },
  {
    email: 'khalid.otaibi@crm.local',
    firstName: 'Khalid',
    lastName: 'Al-Otaibi',
    role: 'manager',
    department: 'TEC',
    branch: 'JED',
    locale: 'AR',
  },
];

export const DEMO_CUSTOMERS: readonly DemoCustomer[] = [
  {
    key: 'hadid',
    firstName: 'Layla',
    lastName: 'Al-Hadid',
    email: 'layla.alhadid@example.com',
    phone: '+966500110022',
    type: 'INDIVIDUAL',
    isVip: false,
    locale: 'AR',
    branch: 'RUH',
  },
  {
    key: 'northgate',
    firstName: 'James',
    lastName: 'Whitfield',
    email: 'j.whitfield@northgate-logistics.example',
    phone: '+441614960001',
    companyName: 'Northgate Logistics',
    type: 'COMPANY',
    isVip: true,
    locale: 'EN',
    branch: 'JED',
  },
  {
    key: 'darwish',
    firstName: 'Omar',
    lastName: 'Darwish',
    email: 'omar.darwish@example.com',
    phone: '+966555443311',
    type: 'INDIVIDUAL',
    isVip: false,
    locale: 'AR',
    branch: 'RUH',
  },
  {
    key: 'meridian',
    firstName: 'Sofia',
    lastName: 'Alvarez',
    email: 's.alvarez@meridian-retail.example',
    phone: '+34911223344',
    companyName: 'Meridian Retail',
    type: 'COMPANY',
    isVip: false,
    locale: 'EN',
    branch: 'JED',
  },
  {
    key: 'rashed',
    firstName: 'Fatima',
    lastName: 'Al-Rashed',
    email: 'fatima.alrashed@example.com',
    phone: '+966533221100',
    type: 'INDIVIDUAL',
    isVip: true,
    locale: 'AR',
    branch: 'RUH',
  },
];

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

/**
 * Fourteen cases, chosen to cover the four statuses, the four priorities, and
 * the edge cases AC4 names — a breach, an unassigned ticket, a long
 * conversation, and attachments.
 *
 * Written as support cases rather than as test fixtures. "Ticket 3" tells a
 * reviewer nothing about whether the queue is readable; "Refund approved on the
 * 3rd, still not in my account" tells them immediately.
 */
export const DEMO_TICKETS: readonly DemoTicket[] = [
  {
    subject: 'Refund approved on the 3rd, still not showing in my account',
    description:
      'Your team approved a refund of SAR 420 for order 44-99213 on the 3rd. It is the 9th and nothing has arrived. My bank says they have had nothing from you.',
    status: 'WAITING_FOR_AGENT',
    escalated: true,
    priority: 'URGENT',
    channel: 'EMAIL',
    customer: 'northgate',
    assignee: 'huda.mansour@crm.local',
    category: 'billing-refund',
    hoursAgo: 96,
    tags: ['refund', 'escalated'],
    messages: [
      {
        from: 'AGENT',
        after: 35,
        body: 'Thank you for chasing this, Mr Whitfield. I can see the refund was approved on the 3rd and left our side the same day. I am asking our payments team for the settlement reference so your bank can trace it.',
      },
      {
        from: 'AGENT',
        isInternal: true,
        after: 40,
        body: 'Payments confirm the batch on the 3rd failed to settle — 14 refunds affected, ours included. They are re-running it tonight. Do not promise a date until that run clears.',
      },
      {
        from: 'CUSTOMER',
        after: 1500,
        body: 'It has now been six days. This is the second refund this quarter that has gone missing. I need a date.',
      },
      {
        from: 'SYSTEM',
        after: 2880,
        body: 'Resolution target passed. Escalated to the department manager.',
      },
    ],
    tasks: [{ title: 'Get settlement reference from payments', status: 'IN_PROGRESS' }],
  },
  {
    subject: 'لا أستطيع تسجيل الدخول بعد تغيير رقم الجوال',
    description:
      'غيّرت رقم جوالي الأسبوع الماضي، والآن رمز التحقق يصل إلى الرقم القديم. لا أستطيع الدخول إلى حسابي منذ يومين.',
    status: 'WAITING_FOR_CUSTOMER',
    priority: 'HIGH',
    channel: 'WEB',
    customer: 'hadid',
    assignee: 'nadia.saleh@crm.local',
    category: 'account-access',
    hoursAgo: 30,
    tags: ['تحقق', 'حساب'],
    messages: [
      {
        from: 'AGENT',
        after: 12,
        body: 'شكرًا لتواصلك. لتحديث رقم الجوال المسجّل نحتاج إلى إثبات هوية: صورة من الهوية الوطنية وصورة لآخر فاتورة. أرسليها هنا وسنكمل التحديث خلال ساعة.',
      },
      {
        from: 'CUSTOMER',
        after: 200,
        body: 'أرسلت صورة الهوية. الفاتورة الأخيرة ليست معي الآن، سأرسلها غدًا.',
        attachments: [{ fileName: 'هوية.jpg', contentType: 'image/jpeg', sizeBytes: 284_113 }],
      },
      {
        from: 'AGENT',
        after: 260,
        body: 'وصلت الهوية، شكرًا. سننتظر الفاتورة لإكمال التحقق. الحساب موقوف مؤقتًا لحمايتك حتى ذلك الحين.',
      },
    ],
  },
  {
    subject: 'API returns 401 for every request since this morning',
    description:
      'All of our integration calls started failing at 06:40 UTC with 401. The key has not changed and it worked yesterday. This is blocking order sync for the whole warehouse.',
    status: 'WAITING_FOR_AGENT',
    priority: 'URGENT',
    channel: 'WEB',
    customer: 'meridian',
    assignee: 'priya.raman@crm.local',
    category: 'technical-integration',
    hoursAgo: 5,
    tags: ['api', 'integration'],
    messages: [
      {
        from: 'AGENT',
        after: 18,
        body: 'Thanks Sofia — I can reproduce it with your account. Your key was rotated by the platform migration at 06:30 and the old one stopped being accepted ten minutes later. The new key is in your dashboard under Integrations. I am checking why you were not warned.',
      },
      {
        from: 'AGENT',
        isInternal: true,
        after: 22,
        body: 'The migration notice went to the billing contact, not the technical one. Worth raising — Meridian will not be the only account this hit.',
      },
      {
        from: 'CUSTOMER',
        after: 45,
        body: 'New key is in and sync is running again. Please do flag the notification thing, we would have had a much worse morning if the warehouse had been busier.',
      },
    ],
    tasks: [{ title: 'Review who receives migration notices', status: 'TODO' }],
  },
  {
    subject: 'Invoice 2026-0441 charges for two seats we cancelled in June',
    description:
      'We cancelled two of the five seats on 14 June and had it confirmed by email. The July invoice still bills for five.',
    status: 'WAITING_FOR_AGENT',
    priority: 'MEDIUM',
    channel: 'EMAIL',
    customer: 'northgate',
    assignee: null,
    category: 'billing-invoice',
    hoursAgo: 20,
    tags: ['invoice'],
    messages: [
      {
        from: 'CUSTOMER',
        after: 900,
        body: 'Following up — is anyone looking at this? The invoice is due on Friday.',
      },
    ],
  },
  {
    subject: 'انقطاع الخدمة في فرع جدة منذ الصباح',
    description:
      'نقاط البيع في فرع جدة لا تتصل بالنظام منذ الساعة السابعة صباحًا. الفرع يعمل يدويًا.',
    status: 'RESOLVED',
    priority: 'URGENT',
    channel: 'WEB',
    customer: 'rashed',
    assignee: 'priya.raman@crm.local',
    category: 'technical-outage',
    hoursAgo: 52,
    tags: ['انقطاع', 'جدة'],
    messages: [
      {
        from: 'AGENT',
        after: 8,
        body: 'وصلنا البلاغ ونحن نتحقق الآن. يبدو أن الانقطاع محصور في فرع جدة وليس عامًا.',
      },
      {
        from: 'AGENT',
        isInternal: true,
        after: 25,
        body: 'المشكلة في موجّه الشبكة بالفرع وليست في النظام. أبلغت فريق الشبكات.',
      },
      {
        from: 'AGENT',
        after: 180,
        body: 'تم استبدال جهاز الشبكة في الفرع وعادت نقاط البيع للعمل. نعتذر عن التعطيل.',
      },
      { from: 'CUSTOMER', after: 200, body: 'تم، كل شيء يعمل الآن. شكرًا لكم.' },
    ],
  },
  {
    subject: 'Order 44-10188 delivered to the wrong branch',
    description:
      'Three boxes meant for Riyadh went to Jeddah. The courier says they cannot redirect without your authorisation.',
    status: 'WAITING_FOR_AGENT',
    priority: 'HIGH',
    channel: 'CHAT',
    customer: 'meridian',
    assignee: 'tom.becker@crm.local',
    category: 'delivery',
    hoursAgo: 40,
    tags: ['delivery', 'courier'],
    messages: [
      {
        from: 'AGENT',
        after: 15,
        body: 'I have the consignment number and I am raising the redirect with the courier now. They usually come back within a working day.',
      },
      {
        from: 'AGENT',
        isInternal: true,
        after: 20,
        body: 'Courier reference RD-88214. Waiting on their operations desk — chase tomorrow morning if nothing.',
      },
    ],
    tasks: [{ title: 'Chase courier on redirect RD-88214', status: 'TODO' }],
  },
  {
    subject: 'Can I change the billing email on the account?',
    description:
      'Our finance contact has left. What is the process for changing the address invoices go to?',
    status: 'RESOLVED',
    priority: 'LOW',
    channel: 'WEB',
    customer: 'meridian',
    assignee: 'huda.mansour@crm.local',
    category: 'billing-invoice',
    hoursAgo: 200,
    tags: ['account'],
    messages: [
      {
        from: 'AGENT',
        after: 90,
        body: 'You can change it yourself under Settings → Billing → Contact. The change takes effect from the next invoice; anything already issued keeps the old address on it.',
      },
      { from: 'CUSTOMER', after: 140, body: 'Done, thank you.' },
    ],
  },
  {
    subject: 'طلب استرداد لم يُعالج منذ أسبوعين',
    description: 'قدّمت طلب استرداد بتاريخ 25 الشهر الماضي ولم أتلقّ أي رد حتى الآن.',
    status: 'NEW',
    priority: 'HIGH',
    channel: 'WEB',
    customer: 'darwish',
    assignee: null,
    category: 'billing-refund',
    hoursAgo: 3,
    tags: ['استرداد'],
    messages: [],
  },
  {
    subject: 'Two-factor codes arriving several minutes late',
    description:
      'Codes take four or five minutes to arrive, by which time they have expired. Started on Monday.',
    status: 'WAITING_FOR_AGENT',
    priority: 'MEDIUM',
    channel: 'EMAIL',
    customer: 'meridian',
    assignee: 'tom.becker@crm.local',
    category: 'account-access',
    hoursAgo: 8,
    tags: ['2fa'],
    messages: [
      {
        from: 'AGENT',
        after: 30,
        body: 'Sorry about that. Which country are the numbers in? Our SMS provider had delays on two routes this week and I want to check whether yours is one of them.',
      },
      { from: 'CUSTOMER', after: 55, body: 'Spain, +34.' },
    ],
  },
  {
    subject: 'Weekly export has been empty since the schema change',
    description:
      'The Monday export file arrives but contains only headers. It was fine until the release on the 1st.',
    status: 'WAITING_FOR_CUSTOMER',
    priority: 'MEDIUM',
    channel: 'EMAIL',
    customer: 'northgate',
    assignee: 'priya.raman@crm.local',
    category: 'technical-integration',
    hoursAgo: 60,
    tags: ['export'],
    messages: [
      {
        from: 'AGENT',
        after: 60,
        body: 'The export now filters on the branch field, which your saved view leaves blank. Could you send a screenshot of the export settings so I can confirm before you change anything?',
        attachments: [
          { fileName: 'export-settings-example.png', contentType: 'image/png', sizeBytes: 91_204 },
        ],
      },
    ],
  },
  {
    subject: 'الفاتورة تصل بالإنجليزية ونحتاجها بالعربية',
    description: 'جميع الفواتير تصل باللغة الإنجليزية. هل يمكن تغيير لغة الفواتير إلى العربية؟',
    status: 'RESOLVED',
    priority: 'LOW',
    channel: 'WHATSAPP',
    customer: 'hadid',
    assignee: 'huda.mansour@crm.local',
    category: 'billing-invoice',
    hoursAgo: 150,
    tags: ['لغة', 'فاتورة'],
    messages: [
      {
        from: 'AGENT',
        after: 45,
        body: 'نعم، يمكن ذلك. غيّرت لغة الحساب إلى العربية، وستصلك الفاتورة القادمة بالعربية. الفواتير السابقة تبقى كما صدرت.',
      },
      { from: 'CUSTOMER', after: 70, body: 'ممتاز، شكرًا جزيلًا.' },
    ],
  },
  {
    subject: 'Duplicate charge on card ending 4417',
    description: 'Charged twice for the same order, ten seconds apart. Order 44-10402.',
    status: 'WAITING_FOR_AGENT',
    priority: 'HIGH',
    channel: 'WEB',
    customer: 'rashed',
    assignee: 'huda.mansour@crm.local',
    category: 'billing-refund',
    hoursAgo: 2,
    tags: ['duplicate', 'card'],
    messages: [
      {
        from: 'AGENT',
        after: 10,
        body: 'I can see both charges and the second one is a duplicate — the payment page was submitted twice. I have voided it; it should drop off your statement within three working days.',
      },
    ],
  },
  {
    subject: 'Long-running: warehouse scanner disconnects every few minutes',
    description:
      'Handheld scanners drop off the network every three to five minutes across the whole warehouse floor. Started after the site move.',
    status: 'WAITING_FOR_AGENT',
    priority: 'HIGH',
    channel: 'EMAIL',
    customer: 'northgate',
    assignee: 'priya.raman@crm.local',
    category: 'technical-outage',
    hoursAgo: 340,
    tags: ['hardware', 'long-running'],
    messages: [
      {
        from: 'AGENT',
        after: 40,
        body: 'Thanks for the detail. Before we look at the scanners themselves, could you confirm whether the drops correlate with the forklift chargers running? We have seen that pattern at two other sites.',
      },
      {
        from: 'CUSTOMER',
        after: 300,
        body: 'Checked — no, it happens overnight as well when the chargers are off.',
      },
      {
        from: 'AGENT',
        after: 400,
        body: 'Understood. Next step is a site survey; I have logged the request and someone will call you to arrange it.',
      },
      {
        from: 'AGENT',
        isInternal: true,
        after: 420,
        body: 'Survey requested, ref SV-2261. This is the third site with the same symptom after a move — worth grouping them.',
      },
      {
        from: 'CUSTOMER',
        after: 2000,
        body: 'Any date for the survey yet? We are still losing scans.',
      },
      {
        from: 'AGENT',
        after: 2100,
        body: 'Survey is booked for Tuesday morning. The engineer will call an hour before arriving.',
      },
      {
        from: 'CUSTOMER',
        after: 5000,
        body: 'Engineer came, replaced two access points. Much better today, will confirm at the end of the week.',
      },
      {
        from: 'AGENT',
        isInternal: true,
        after: 5100,
        body: 'Keep open until Friday, then close if no further drops.',
      },
    ],
    tasks: [
      { title: 'Site survey SV-2261', status: 'DONE' },
      { title: 'Confirm with Northgate on Friday', status: 'TODO' },
    ],
  },
  {
    subject: 'وصل الطلب ناقصًا صندوقًا واحدًا',
    description:
      'الطلب رقم 44-10555 وصل بثلاثة صناديق بدلًا من أربعة. الصندوق الناقص يحتوي على الملحقات.',
    status: 'NEW',
    priority: 'MEDIUM',
    channel: 'WHATSAPP',
    customer: 'darwish',
    assignee: null,
    category: 'delivery',
    hoursAgo: 1,
    tags: ['توصيل'],
    messages: [],
  },
];

// ---------------------------------------------------------------------------
// Knowledge base
// ---------------------------------------------------------------------------

/**
 * Three articles, one of them a matched English/Arabic pair.
 *
 * The knowledge base itself (P09) is deferred, but AC1 names articles and the
 * model exists. A translation pair is the part worth seeding: it is the only
 * way to see that `translationGroupId` does what US-6 intended.
 */
export const DEMO_ARTICLES: readonly DemoArticle[] = [
  {
    translationGroup: 'reset-2fa',
    locale: 'EN',
    slug: 'reset-two-factor-authentication',
    title: 'Resetting two-factor authentication',
    excerpt: 'What to do when a customer cannot receive their verification code.',
    body: 'Verify identity before changing anything. Ask for national ID and one recent invoice, and check that the name on both matches the account.\n\nOnce verified, open the customer record, choose Security, and select Reset two-factor. The customer receives a one-time link valid for fifteen minutes.\n\nIf the customer no longer has the old number **and** cannot produce an invoice, escalate to a manager rather than proceeding. An account takeover looks exactly like a lost phone from this side of the conversation.',
    category: 'account-access',
    status: 'PUBLISHED',
  },
  {
    translationGroup: 'reset-2fa',
    locale: 'AR',
    slug: 'اعادة-ضبط-التحقق-بخطوتين',
    title: 'إعادة ضبط التحقق بخطوتين',
    excerpt: 'ما العمل عندما لا يصل رمز التحقق إلى العميل.',
    body: 'تحقّق من الهوية قبل أي تغيير. اطلب الهوية الوطنية وفاتورة حديثة، وتأكد من تطابق الاسم في كليهما مع الحساب.\n\nبعد التحقق، افتح ملف العميل، اختر «الأمان»، ثم «إعادة ضبط التحقق بخطوتين». يصل العميل رابط صالح لخمس عشرة دقيقة.\n\nإذا لم يكن لدى العميل الرقم القديم ولا يستطيع تقديم فاتورة، حوّل الطلب إلى المشرف ولا تكمل الإجراء. فمحاولة الاستيلاء على الحساب تبدو من هنا مطابقة تمامًا لحالة فقدان الهاتف.',
    category: 'account-access',
    status: 'PUBLISHED',
  },
  {
    translationGroup: 'refund-timelines',
    locale: 'EN',
    slug: 'refund-timelines',
    title: 'How long a refund takes',
    excerpt: 'The three stages of a refund, and what to tell a customer at each one.',
    body: 'A refund passes through approval, settlement, and the customer’s bank. Only the first is instant.\n\nApproval is same-day once an agent authorises it. Settlement runs nightly and can fail as a batch — if a customer says a refund never arrived, check the settlement run before telling them to contact their bank.\n\nBanks then take between one and five working days. Do not promise a specific date; give the range and the settlement reference.',
    category: 'billing-refund',
    status: 'PUBLISHED',
  },
];
