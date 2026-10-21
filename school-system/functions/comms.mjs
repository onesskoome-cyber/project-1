import { ok, requireRole, studentScope, unwrap } from "./shared.mjs";
import * as v from "./validate.mjs";

const AUDIENCES = ["all", "parents", "teachers", "class"];
const USER_COLUMNS = "id,username,role,full_name,email,phone,is_active";

async function loadUser(supabase, userId) {
  const rows = unwrap(
    await supabase.from("users").select(USER_COLUMNS).eq("id", userId).limit(1),
  );
  return rows?.[0] ?? null;
}

/** Classes a parent's children belong to. */
async function parentClassIds(supabase, userId) {
  const rows = unwrap(
    await supabase.from("students").select("class_id").eq("parent_user_id", userId).limit(50),
  ) ?? [];
  return [...new Set(rows.map((row) => row.class_id).filter(Boolean))];
}

/** Teachers responsible for the given classes, as class teacher or subject teacher. */
async function teachersOfClasses(supabase, classIds) {
  if (!classIds.length) return new Map();
  const teachers = new Map();
  const classRows = unwrap(
    await supabase.from("classes").select("id,name,teacher_id").in("id", classIds).limit(50),
  ) ?? [];
  const subjectRows = unwrap(
    await supabase.from("class_subjects").select("class_id,subject_id,teacher_id").in("class_id", classIds).limit(500),
  ) ?? [];
  const ids = new Set();
  for (const row of classRows) if (row.teacher_id) ids.add(row.teacher_id);
  for (const row of subjectRows) if (row.teacher_id) ids.add(row.teacher_id);
  if (!ids.size) return teachers;
  const users = unwrap(
    await supabase.from("users").select("id,full_name,role").in("id", [...ids]).limit(200),
  ) ?? [];
  for (const user of users) teachers.set(user.id, user.full_name);
  return teachers;
}

/**
 * Whether a sender may open a conversation with a recipient. Staff may reach
 * any parent in their scope; a parent may reach staff responsible for their
 * own children, plus the office roles.
 */
export async function canMessage(supabase, sender, recipientId) {
  if (sender.id === recipientId) throw v.httpError("cannot_message_self");
  const recipient = await loadUser(supabase, recipientId);
  if (!recipient || !recipient.is_active) throw v.httpError("recipient_not_found", 404);

  if (sender.role === "admin") return recipient;
  if (sender.role === "accountant") {
    if (!["parent", "admin", "accountant"].includes(recipient.role)) {
      throw v.httpError("recipient_not_permitted", 403);
    }
    return recipient;
  }

  if (sender.role === "teacher") {
    if (recipient.role === "admin") return recipient;
    if (recipient.role !== "parent") throw v.httpError("recipient_not_permitted", 403);
    const scope = await studentScope(supabase, sender);
    if (!scope.classIds.length) throw v.httpError("recipient_not_permitted", 403);
    const children = unwrap(
      await supabase
        .from("students")
        .select("id")
        .eq("parent_user_id", recipientId)
        .in("class_id", scope.classIds)
        .limit(1),
    ) ?? [];
    if (!children.length) throw v.httpError("recipient_not_permitted", 403);
    return recipient;
  }

  // parent
  if (["admin", "accountant"].includes(recipient.role)) return recipient;
  if (recipient.role !== "teacher") throw v.httpError("recipient_not_permitted", 403);
  const classIds = await parentClassIds(supabase, sender.id);
  const teachers = await teachersOfClasses(supabase, classIds);
  if (!teachers.has(recipientId)) throw v.httpError("recipient_not_permitted", 403);
  return recipient;
}

export async function contacts(supabase, user) {
  if (user.role === "admin") {
    const rows = unwrap(
      await supabase.from("users").select(USER_COLUMNS).eq("is_active", true).order("full_name").limit(500),
    ) ?? [];
    return ok({ items: rows.filter((row) => row.id !== user.id).map(toContact) });
  }

  if (user.role === "accountant") {
    const rows = unwrap(
      await supabase.from("users").select(USER_COLUMNS).eq("is_active", true).order("full_name").limit(500),
    ) ?? [];
    return ok({
      items: rows
        .filter((row) => row.id !== user.id && ["parent", "admin", "accountant"].includes(row.role))
        .map(toContact),
    });
  }

  if (user.role === "teacher") {
    const scope = await studentScope(supabase, user);
    const items = [];
    if (scope.classIds.length) {
      const students = unwrap(
        await supabase
          .from("students")
          .select("parent_user_id,first_name,last_name")
          .in("class_id", scope.classIds)
          .eq("is_active", true)
          .limit(500),
      ) ?? [];
      const parentIds = [...new Set(students.map((row) => row.parent_user_id).filter(Boolean))];
      if (parentIds.length) {
        const parents = unwrap(
          await supabase.from("users").select(USER_COLUMNS).in("id", parentIds).eq("is_active", true).limit(500),
        ) ?? [];
        for (const parent of parents) {
          const children = students
            .filter((row) => row.parent_user_id === parent.id)
            .map((row) => `${row.first_name} ${row.last_name}`);
          items.push({ ...toContact(parent), context: children });
        }
      }
    }
    const admins = unwrap(
      await supabase.from("users").select(USER_COLUMNS).eq("role", "admin").eq("is_active", true).limit(50),
    ) ?? [];
    for (const admin of admins) items.push(toContact(admin));
    return ok({ items: dedupe(items) });
  }

  // parent
  const classIds = await parentClassIds(supabase, user.id);
  const teachers = await teachersOfClasses(supabase, classIds);
  const items = [];
  if (teachers.size) {
    const rows = unwrap(
      await supabase.from("users").select(USER_COLUMNS).in("id", [...teachers.keys()]).eq("is_active", true).limit(100),
    ) ?? [];
    for (const row of rows) items.push(toContact(row));
  }
  const office = unwrap(
    await supabase.from("users").select(USER_COLUMNS).in("role", ["admin", "accountant"]).eq("is_active", true).limit(50),
  ) ?? [];
  for (const row of office) items.push(toContact(row));
  return ok({ items: dedupe(items) });
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function toContact(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    role: row.role,
    email: row.email ?? null,
    phone: row.phone ?? null,
    context: [],
  };
}

export async function listMessages(supabase, user, params) {
  const folder = v.optOneOf(params.folder, ["inbox", "sent"], "folder") ?? "inbox";
  const column = folder === "inbox" ? "recipient_id" : "sender_id";
  const { offset, limit } = v.pageBounds(params.offset, params.limit, 50, 100);

  const rows = unwrap(
    await supabase
      .from("messages")
      .select("id,sender_id,recipient_id,subject,body,student_id,read_at,created_at")
      .eq(column, user.id)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1),
  ) ?? [];

  const otherIds = [...new Set(rows.map((row) => (folder === "inbox" ? row.sender_id : row.recipient_id)))];
  const names = new Map();
  if (otherIds.length) {
    const list = unwrap(await supabase.from("users").select("id,full_name,role").in("id", otherIds));
    for (const row of list ?? []) names.set(row.id, { fullName: row.full_name, role: row.role });
  }
  const studentNames = await studentNames(supabase, rows.map((row) => row.student_id));

  return ok({
    folder,
    items: rows.map((row) => {
      const otherId = folder === "inbox" ? row.sender_id : row.recipient_id;
      return {
        id: row.id,
        direction: folder === "inbox" ? "in" : "out",
        otherId,
        otherName: names.get(otherId)?.fullName ?? "Unknown",
        otherRole: names.get(otherId)?.role ?? null,
        subject: row.subject,
        body: row.body,
        studentId: row.student_id ?? null,
        studentName: studentNames.get(row.student_id) ?? null,
        readAt: row.read_at,
        createdAt: row.created_at,
      };
    }),
  });
}

async function studentNames(supabase, studentIds) {
  const ids = [...new Set(studentIds.filter(Boolean))];
  const names = new Map();
  if (!ids.length) return names;
  const rows = unwrap(
    await supabase.from("students").select("id,first_name,last_name").in("id", ids).limit(200),
  ) ?? [];
  for (const row of rows) names.set(row.id, `${row.first_name} ${row.last_name}`);
  return names;
}

export async function sendMessage(supabase, user, params) {
  const recipientId = v.reqId(v.reqText(params.recipientId, "recipientId"), "recipientId");
  const subject = v.reqText(params.subject, "subject", 140);
  const body = v.reqText(params.body, "body", 4000);
  const studentId = v.optId(params.studentId, "studentId");
  await canMessage(supabase, user, recipientId);

  if (studentId) {
    const scope = await studentScope(supabase, user);
    const rows = unwrap(
      await supabase.from("students").select("id,parent_user_id,class_id").eq("id", studentId).limit(1),
    ) ?? [];
    const student = rows[0];
    if (!student) throw v.httpError("student_not_found", 404);
    if (user.role === "parent" && student.parent_user_id !== user.id) {
      throw v.httpError("forbidden", 403);
    }
    if (user.role === "teacher" && !scope.all && !scope.classIds.includes(student.class_id)) {
      throw v.httpError("forbidden", 403);
    }
  }

  const id = crypto.randomUUID();
  unwrap(
    await supabase
      .from("messages")
      .insert({
        id,
        sender_id: user.id,
        recipient_id: recipientId,
        subject,
        body,
        student_id: studentId,
        read_at: null,
        created_at: v.nowIso(),
      })
      .select("id")
      .maybeSingle(),
  );
  return ok({ id }, 201);
}

export async function markRead(supabase, user, params) {
  const messageId = v.reqId(v.reqText(params.messageId, "messageId"), "messageId");
  const updated = unwrap(
    await supabase
      .from("messages")
      .update({ read_at: v.nowIso() })
      .eq("id", messageId)
      .eq("recipient_id", user.id)
      .is("read_at", null)
      .select("id")
      .maybeSingle(),
  );
  if (!updated) throw v.httpError("message_not_found", 404);
  return ok({ id: messageId });
}

export async function listAnnouncements(supabase, user) {
  const rows = unwrap(
    await supabase
      .from("announcements")
      .select("id,author_id,title,body,audience,class_id,created_at")
      .order("created_at", { ascending: false })
      .limit(50),
  ) ?? [];

  const scope = await studentScope(supabase, user);
  const visible = rows.filter((row) => {
    if (row.audience === "all") return true;
    if (row.audience === "parents") return user.role === "parent" || user.role === "admin";
    if (row.audience === "teachers") return user.role === "teacher" || user.role === "admin";
    if (row.audience === "class") {
      if (user.role === "admin" || user.role === "accountant") return true;
      if (scope.all) return true;
      if (scope.by === "class") return scope.classIds.includes(row.class_id);
      return false;
    }
    return false;
  });

  const authorIds = [...new Set(visible.map((row) => row.author_id))];
  const authors = new Map();
  if (authorIds.length) {
    const list = unwrap(await supabase.from("users").select("id,full_name").in("id", authorIds));
    for (const row of list ?? []) authors.set(row.id, row.full_name);
  }
  const classIds = [...new Set(visible.map((row) => row.class_id).filter(Boolean))];
  const classNames = new Map();
  if (classIds.length) {
    const list = unwrap(await supabase.from("classes").select("id,name").in("id", classIds));
    for (const row of list ?? []) classNames.set(row.id, row.name);
  }

  return ok({
    items: visible.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      audience: row.audience,
      classId: row.class_id ?? null,
      className: classNames.get(row.class_id) ?? null,
      author: authors.get(row.author_id) ?? "School office",
      createdAt: row.created_at,
    })),
  });
}

export async function saveAnnouncement(supabase, user, params) {
  requireRole(user, "admin");
  const title = v.reqText(params.title, "title", 140);
  const body = v.reqText(params.body, "body", 4000);
  const audience = v.reqOneOf(params.audience, AUDIENCES, "audience");
  const classId = v.optId(params.classId, "classId");
  if (audience === "class" && !classId) throw v.httpError("classId_required");

  const id = crypto.randomUUID();
  unwrap(
    await supabase
      .from("announcements")
      .insert({ id, author_id: user.id, title, body, audience, class_id: classId, created_at: v.nowIso() })
      .select("id")
      .maybeSingle(),
  );
  return ok({ id }, 201);
}

// A missing badge must not fail the dashboard, so this degrades to zero.
export async function unreadCount(supabase, user) {
  const result = await supabase
    .from("messages")
    .select("id", { count: "exact" })
    .eq("recipient_id", user.id)
    .is("read_at", null)
    .limit(1);
  if (result.error || !Number.isSafeInteger(result.count)) return 0;
  return result.count;
}
