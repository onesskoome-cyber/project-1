import { hashPassword, randomHex } from "./crypto.mjs";
import { gradeFor, pointsFor } from "./grading.mjs";
import { ok, putSetting, requireRole, unwrap, exactCount } from "./shared.mjs";
import * as v from "./validate.mjs";

// Deterministic PRNG so a re-seeded demo school looks the same each time.
function rng(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function insertAll(supabase, table, rows) {
  for (const part of chunk(rows, 200)) {
    unwrap(await supabase.from(table).insert(part).select("id"));
  }
}

function recentWeekdays(count, endDate = new Date()) {
  const days = [];
  const cursor = new Date(endDate);
  while (days.length < count) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.push(cursor.toISOString().slice(0, 10));
  }
  return days;
}

const SUBJECTS = [
  ["MAT", "Mathematics"], ["ENG", "English"], ["KIS", "Kiswahili"], ["BIO", "Biology"],
  ["CHE", "Chemistry"], ["PHY", "Physics"], ["HIS", "History & Government"],
  ["GEO", "Geography"], ["CRE", "Christian Religious Education"], ["BUS", "Business Studies"],
];

const CLASSES = [
  ["Form 1A", 1, "A"], ["Form 1B", 1, "B"], ["Form 2A", 2, "A"], ["Form 2B", 2, "B"],
  ["Form 3A", 3, "A"], ["Form 3B", 3, "B"], ["Form 4A", 4, "A"], ["Form 4B", 4, "B"],
];

const TEACHERS = [
  ["j.kamau", "James Kamau", "jkamau@mwangaza-demo.ac.ke"],
  ["g.achieng", "Grace Achieng", "gachieng@mwangaza-demo.ac.ke"],
  ["p.njoroge", "Peter Njoroge", "pnjoroge@mwangaza-demo.ac.ke"],
  ["m.wanjiku", "Mary Wanjiku", "mwanjiku@mwangaza-demo.ac.ke"],
  ["s.otieno", "Samuel Otieno", "sotieno@mwangaza-demo.ac.ke"],
  ["a.chebet", "Anne Chebet", "achebet@mwangaza-demo.ac.ke"],
  ["d.mwangi", "David Mwangi", "dmwangi@mwangaza-demo.ac.ke"],
  ["r.auma", "Ruth Auma", "rauma@mwangaza-demo.ac.ke"],
];

const FIRST_M = ["Brian", "Kevin", "Moses", "Dennis", "Collins", "Victor", "Edwin", "Felix", "Kelvin", "Allan",
  "Samuel", "Ivan", "Trevor", "Emmanuel", "Derrick", "Joshua", "Ryan", "Malcolm", "Nigel", "Shawn"];
const FIRST_F = ["Faith", "Mercy", "Joy", "Wanjiru", "Sharon", "Cynthia", "Njeri", "Atieno", "Muthoni", "Nyambura",
  "Zawadi", "Amina", "Lilian", "Ivy", "Zena", "Halima", "Belinda", "Esther", "Diana", "Naomi"];
const SURNAMES = ["Kamau", "Mwangi", "Otieno", "Wanjala", "Kiprotich", "Mutua", "Njoroge", "Odhiambo", "Chebet",
  "Kimani", "Achieng", "Barasa", "Wekesa", "Njeri", "Gathoni", "Omondi", "Atieno", "Kariuki", "Maina", "Owino"];

const PARENTS = [
  ["p.wanjiru", "Pauline Wanjiru"], ["j.otieno", "John Otieno"], ["e.chebet", "Esther Chebet"],
  ["m.kariuki", "Michael Kariuki"], ["a.njeri", "Agnes Njeri"], ["d.barasa", "Daniel Barasa"],
  ["s.mutua", "Susan Mutua"], ["k.omondi", "Kenneth Omondi"], ["l.gathoni", "Lucy Gathoni"],
  ["b.wekesa", "Benjamin Wekesa"], ["r.atieno", "Rose Atieno"], ["t.mwangi", "Thomas Mwangi"],
  ["n.kamau", "Nancy Kamau"], ["g.owino", "George Owino"], ["f.wanjala", "Florence Wanjala"],
  ["h.kiprotich", "Henry Kiprotich"], ["c.achieng", "Caroline Achieng"], ["v.kimani", "Victor Kimani"],
  ["b.maina", "Beatrice Maina"], ["o.njoroge", "Obadiah Njoroge"],
];

// Realistic Kenyan day-school plus boarding fee structure, in whole shillings.
function feeItems(level) {
  return [
    { label: "Tuition", amount: 16500 + level * 900 },
    { label: "Boarding", amount: 8200 + level * 300 },
    { label: "Lunch Programme", amount: 4200 },
    { label: "Activity Fee", amount: 1200 },
    { label: "Examination Fee", amount: 800 },
  ];
}

export async function seedDemo(supabase, user) {
  requireRole(user, "admin");
  const existing = await exactCount(supabase, "classes", null);
  if (existing > 0) throw v.httpError("already_seeded", 409);

  const random = rng(20261019);
  const now = v.nowIso();
  const term = 3;
  const year = 2026;

  for (const [key, value] of Object.entries({
    schoolName: "Mwangaza Secondary School",
    motto: "Elimu ni Ufunguo wa Maisha",
    currencyCode: "KES",
    currencySymbol: "KSh",
    currentTerm: term,
    currentYear: year,
    contactEmail: "office@mwangaza-demo.ac.ke",
    contactPhone: "+254 700 000 000",
    address: "P.O. Box 100-00200, Nakuru, Kenya",
    sampleData: true,
    termDates: { 1: "Jan - Apr", 2: "May - Aug", 3: "Sep - Nov" },
  })) {
    await putSetting(supabase, key, value);
  }

  const subjects = SUBJECTS.map(([code, name]) => ({
    id: crypto.randomUUID(), code, name, is_active: true,
  }));
  await insertAll(supabase, "subjects", subjects);

  const teacherUsers = [];
  for (const [username, fullName, email] of TEACHERS) {
    teacherUsers.push({
      id: crypto.randomUUID(), username, full_name: fullName, email,
      phone: `+254 7${String(Math.floor(random() * 90000000) + 10000000)}`, role: "teacher",
    });
  }
  const bursar = {
    id: crypto.randomUUID(), username: "bursar", full_name: "Joseph Kiptoo",
    email: "bursar@mwangaza-demo.ac.ke", phone: "+254 711 223 344", role: "accountant",
  };
  const parentUsers = PARENTS.map(([username, fullName], index) => ({
    id: crypto.randomUUID(), username, full_name: fullName,
    email: `${username.replace(".", "")}@example.com`,
    phone: `+254 7${String(20000000 + index * 137000)}`, role: "parent",
  }));

  const allStaff = [...teacherUsers, bursar];
  await insertUsersWithPassword(supabase, allStaff, "Teacher@123");
  await insertUsersWithPassword(supabase, parentUsers, "Parent@123");

  const classes = CLASSES.map(([name, level, stream], index) => ({
    id: crypto.randomUUID(), name, level, stream,
    teacher_id: teacherUsers[index].id, created_at: now,
  }));
  await insertAll(supabase, "classes", classes);

  const classSubjects = [];
  for (const cls of classes) {
    for (const subject of subjects) {
      classSubjects.push({
        id: crypto.randomUUID(),
        subject_key: `${cls.id}|${subject.id}`,
        class_id: cls.id,
        subject_id: subject.id,
        teacher_id: teacherUsers[Math.floor(random() * teacherUsers.length)].id,
      });
    }
  }
  await insertAll(supabase, "class_subjects", classSubjects);

  const students = [];
  for (let index = 0; index < 40; index += 1) {
    const female = index % 2 === 1;
    const firstName = female ? FIRST_F[Math.floor(index / 2)] : FIRST_M[Math.floor(index / 2)];
    const lastName = SURNAMES[index % SURNAMES.length];
    const cls = classes[Math.floor(index / 5)];
    const parent = parentUsers[index % parentUsers.length];
    students.push({
      id: crypto.randomUUID(),
      admission_no: `MWZ/${year}/${String(index + 1).padStart(3, "0")}`,
      first_name: firstName,
      last_name: lastName,
      gender: female ? "female" : "male",
      birth_date: `${2014 - cls.level - (index % 2)}-${String((index % 12) + 1).padStart(2, "0")}-${String((index % 27) + 1).padStart(2, "0")}`,
      class_id: cls.id,
      parent_user_id: parent.id,
      guardian_name: parent.full_name,
      guardian_phone: parent.phone,
      is_active: true,
      created_at: now,
    });
  }
  await insertAll(supabase, "students", students);

  // Attendance for the last 10 school days, with realistic absence rates.
  const days = recentWeekdays(10);
  const attendance = [];
  for (const day of days) {
    for (const student of students) {
      const roll = random();
      const status = roll > 0.93 ? "sick" : roll > 0.85 ? "absent" : "present";
      attendance.push({
        id: crypto.randomUUID(),
        record_key: `${student.id}|${day}`,
        student_id: student.id,
        class_id: student.class_id,
        day,
        status,
        note: status === "sick" ? "Reported unwell, sent to clinic" : null,
        recorded_by: classes.find((cls) => cls.id === student.class_id).teacher_id,
        recorded_at: now,
      });
    }
  }
  await insertAll(supabase, "attendance", attendance);

  const exams = classes.map((cls) => ({
    id: crypto.randomUUID(),
    name: `Term ${term} Mid Term Exam`,
    term, year,
    class_id: cls.id,
    exam_date: days[4],
    created_at: now,
  }));
  await insertAll(supabase, "exams", exams);

  const results = [];
  for (const exam of exams) {
    const cohort = students.filter((student) => student.class_id === exam.class_id);
    for (const student of cohort) {
      // Each student has an ability bias so rankings look plausible.
      const ability = 45 + Math.floor(random() * 40);
      for (const subject of subjects) {
        const marks = Math.max(15, Math.min(98, ability + Math.floor(random() * 25) - 12));
        results.push({
          id: crypto.randomUUID(),
          result_key: `${exam.id}|${student.id}|${subject.id}`,
          exam_id: exam.id,
          student_id: student.id,
          subject_id: subject.id,
          marks,
          grade: gradeFor(marks),
          points: pointsFor(marks),
          entered_by: classes.find((cls) => cls.id === exam.class_id).teacher_id,
          entered_at: now,
        });
      }
    }
  }
  await insertAll(supabase, "results", results);

  const structures = classes.map((cls) => {
    const items = feeItems(cls.level);
    return {
      id: crypto.randomUUID(),
      structure_key: `${cls.id}|${term}|${year}`,
      class_id: cls.id, term, year,
      items,
      total: items.reduce((sum, item) => sum + item.amount, 0),
      created_at: now,
    };
  });
  await insertAll(supabase, "fee_structures", structures);

  const invoices = students.map((student) => {
    const structure = structures.find((row) => row.class_id === student.class_id);
    return {
      id: crypto.randomUUID(),
      invoice_key: `${student.id}|${term}|${year}`,
      student_id: student.id,
      class_id: student.class_id,
      term, year,
      items: structure.items,
      amount: structure.total,
      created_at: now,
    };
  });
  await insertAll(supabase, "invoices", invoices);

  const payments = [];
  invoices.forEach((invoice, index) => {
    // 42% settle in full, 28% pay a part instalment, 30% remain unpaid.
    const roll = random();
    if (roll > 0.70) return;
    const method = roll > 0.25 ? "mpesa" : roll > 0.12 ? "bank" : "cash";
    const full = roll <= 0.42;
    payments.push({
      id: crypto.randomUUID(),
      invoice_id: invoice.id,
      student_id: invoice.student_id,
      term,
      year,
      amount: full ? invoice.amount : Math.round(invoice.amount * (0.3 + random() * 0.3)),
      method,
      reference: method === "mpesa"
        ? `SJ${String(index).padStart(4, "0")}${Math.floor(random() * 900 + 100)}`
        : `CHQ-${1000 + index}`,
      note: full ? "Full term payment" : "Part payment, balance by end of term",
      received_by: bursar.id,
      paid_at: now,
    });
  });
  await insertAll(supabase, "payments", payments);

  const messages = [];
  const push = (senderId, recipientId, subject, body, studentId = null, readAt = null) =>
    messages.push({
      id: crypto.randomUUID(), sender_id: senderId, recipient_id: recipientId,
      subject, body, student_id: studentId, read_at: readAt, created_at: now,
    });

  // Each conversation must respect the same rules the live API enforces: a
  // class teacher and the parent of a child actually in that class.
  const teacherOf = (student) => classes.find((cls) => cls.id === student.class_id).teacher_id;
  const sample = [students[0], students[6], students[12], students[18], students[24], students[30]];

  const a = sample[0];
  push(teacherOf(a), a.parent_user_id, "Progress check-in",
    `${a.first_name} has settled in well this term and participates confidently in class. Mathematics homework is often incomplete though. Could we arrange a short call this week?`, a.id);
  const b = sample[1];
  push(b.parent_user_id, teacherOf(b), "Re: Absence last week",
    "Thank you for letting me know. She was unwell and has since recovered. She will bring the clinic note on Monday morning.", b.id, now);
  const c = sample[2];
  push(bursar.id, c.parent_user_id, "Term 3 fee balance",
    `A balance remains on ${c.first_name}'s Term 3 invoice. Kindly settle it before the end of the month to avoid examination clearance delays.`, c.id);
  push(teacherOf(c), c.parent_user_id, "Mid term results released",
    `Term 3 mid term results for ${c.first_name} are now available in your parent portal. Overall performance has improved since Term 2, especially in the sciences.`, c.id);
  const d = sample[3];
  push(d.parent_user_id, bursar.id, "Payment confirmation",
    "I sent the outstanding fee balance via M-Pesa this morning. Kindly confirm receipt and update the invoice.", d.id);
  const e = sample[4];
  push(teacherOf(e), e.parent_user_id, "Sports day selection",
    `${e.first_name} has been selected for the inter-house athletics team. Practice begins Thursday at 4pm on the main field.`, e.id);

  await insertAll(supabase, "messages", messages);

  const announcements = [
    ["Term 3 Mid Term results released", "Results for the Term 3 mid term examination are now available to parents in the portal. Class teachers are available for consultations on Friday from 2pm.", "parents", null],
    ["Staff meeting - Thursday 4pm", "All teaching staff to attend the Term 3 academic review in the staffroom. Bring your subject progress registers.", "teachers", null],
    ["Preparation for Form 4 mock exams", "Form 4 candidates begin mock examinations in two weeks. Remedial classes run every Saturday morning.", "class", classes[6].id],
    ["Parents' Open Day", "The Term 3 open day is scheduled for the last Friday of the month. Academic and finance desks will be available from 9am.", "all", null],
  ].map(([title, body, audience, classId]) => ({
    id: crypto.randomUUID(), author_id: user.id, title, body, audience,
    class_id: classId, created_at: now,
  }));
  await insertAll(supabase, "announcements", announcements);

  return ok({
    seeded: true,
    counts: {
      classes: classes.length,
      subjects: subjects.length,
      students: students.length,
      teachers: teacherUsers.length,
      parents: parentUsers.length,
      exams: exams.length,
      results: results.length,
      attendance: attendance.length,
      invoices: invoices.length,
      payments: payments.length,
      messages: messages.length,
      announcements: announcements.length,
    },
    // Documented demo credentials for a database holding no real records.
    demoAccounts: [
      { role: "Class teacher (Form 1A)", username: TEACHERS[0][0], password: "Teacher@123" },
      { role: "Class teacher (Form 3A)", username: TEACHERS[4][0], password: "Teacher@123" },
      { role: "Bursar", username: "bursar", password: "Teacher@123" },
      { role: "Parent (2 children)", username: PARENTS[0][0], password: "Parent@123" },
      { role: "Parent (2 children)", username: PARENTS[2][0], password: "Parent@123" },
    ],
  });
}

async function insertUsersWithPassword(supabase, users, password) {
  const rows = await Promise.all(
    users.map(async (user) => {
      const salt = randomHex(16);
      return {
        id: user.id,
        username: user.username,
        password_hash: await hashPassword(password, salt),
        salt,
        role: user.role,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        is_active: true,
        created_at: v.nowIso(),
      };
    }),
  );
  await insertAll(supabase, "users", rows);
}
