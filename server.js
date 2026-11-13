require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");
const supabase = require("./supabase");

const app = express();
const resend = new Resend(process.env.RESEND_API_KEY);

const CODE_EXPIRY = 10 * 60 * 1000;

// Email sending disabled until
// your sending domain is ready.
const SEND_TRANSFER_OTP_EMAIL = true;

/* =====================================================
   CONFIG
===================================================== */

const PORT = process.env.PORT || 5000;

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("WARNING: SUPABASE_SERVICE_ROLE_KEY is missing");
}

console.log("SERVICE ROLE KEY LOADED:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);

/* =====================================================
   MIDDLEWARE
===================================================== */

app.use(cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json({ limit: "2mb" }));

/* =====================================================
   BASIC
===================================================== */

app.get("/", (req, res) => {
  res.json({ success: true, message: "Crest United Bank API is running" });
});

app.get("/api/health", (req, res) => {
  res.json({ success: true, message: "API healthy", timestamp: new Date().toISOString() });
});

app.get("/api/test-supabase", async (req, res) => {
    try {
      const { error } = await supabase.from("profiles").select("id").limit(1);
      if (error) {
        console.error("SUPABASE TEST ERROR:", error);
        return res.status(500).json({ success: false, message: "Supabase connection failed", error: error.message });
      }
      return res.json({ success: true, message: "Supabase connection successful" });
    } catch (error) {
      console.error("SUPABASE TEST EXCEPTION:", error);
      return res.status(500).json({ success: false, message: "Internal server error", error: error.message });
    }
});

/* =====================================================
   HELPERS
===================================================== */

function generateReference(prefix = "STL") {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function formatMoneyServer(amount) {
  const n = Number(amount);
  const safe = Number.isFinite(n) ? n : 0;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(safe);
  } catch (e) {
    return `$${safe.toFixed(2)}`;
  }
}

function isAdminValue(value) {
  if (value === true || value === 1 || value === "1") return true;
  return String(value || "").trim().toLowerCase() === "true";
}

function isSuspendedValue(value) {
  if (value === true || value === 1 || value === "1") return true;
  return String(value || "").trim().toLowerCase() === "true";
}

function isAccepted(value) {
  if (value === true || value === 1) return true;
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["true", "1", "on", "yes"].includes(normalized);
}

function generateCardDetails() {
  const cardNumber = "4" + Math.floor(100000000004795 + Math.random() * 900000000002596).toString();
  const last4 = cardNumber.slice(-4);
  const now = new Date();
  const expiryMonth = String(now.getMonth() + 1).padStart(2, "0");
  const expiryYear = String(now.getFullYear() + 3).slice(-2);
  const cvv = crypto.randomInt(100, 999).toString();

  return { card_number: cardNumber, last_four: last4, expiry_month: expiryMonth, expiry_year: expiryYear, cvv: cvv };
}

const PROFILE_PHOTO_BUCKET = "profile-photos";
const PROFILE_PHOTO_MAX_BYTES = 1.5 * 1024 * 1024;

function getProfileAvatarUrl(avatarPath) {
  if (!avatarPath) return null;
  try {
    const { data } = supabase.storage.from(PROFILE_PHOTO_BUCKET).getPublicUrl(avatarPath);
    return data?.publicUrl || null;
  } catch (error) {
    console.error("PROFILE PHOTO PUBLIC URL ERROR:", error);
    return null;
  }
}

async function generateAccountNumber() {
  for (let attempt = 0; attempt < 50; attempt++) {
    const number = "4" + crypto.randomInt(100000000, 1000000000);
    const { data, error } = await supabase.from("accounts").select("id").eq("account_number", number).limit(1);

    if (error) {
      console.error("ACCOUNT NUMBER CHECK ERROR:", error);
      throw new Error("Unable to generate account number");
    }
    if (!data || data.length === 0) return number;
  }
  throw new Error("Unable to generate unique account number");
}

async function cleanupRegistration(userId, accountId = null) {
  if (!userId) return;
  try { if (accountId) await supabase.from("account_balances").delete().eq("account_id", accountId); } catch (error) { console.error(error); }
  try { if (accountId) await supabase.from("accounts").delete().eq("id", accountId).eq("user_id", userId); } catch (error) { console.error(error); }
  try { await supabase.from("customer_addresses").delete().eq("user_id", userId); } catch (error) { console.error(error); }
  try { await supabase.from("customer_consents").delete().eq("user_id", userId); } catch (error) { console.error(error); }
  try { await supabase.from("notifications").delete().eq("user_id", userId); } catch (error) { console.error(error); }
  try { await supabase.from("profiles").delete().eq("id", userId); } catch (error) { console.error(error); }
  try { await supabase.auth.admin.deleteUser(userId); } catch (error) { console.error(error); }
}

/* =====================================================
   AUTHENTICATION
===================================================== */

async function authenticate(req, res, next) {
  try {
    const authorization = req.headers.authorization || "";
    if (!authorization.startsWith("Bearer ")) return res.status(401).json({ success: false, message: "Authentication required" });

    const token = authorization.substring(7).trim();
    if (!token) return res.status(401).json({ success: false, message: "Authentication token missing" });

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ success: false, message: "Invalid or expired session" });

    req.user = data.user;
    req.accessToken = token;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: "Authentication failed" });
  }
}

async function authenticateAdmin(req, res, next) {
  try {
    const authorization = req.headers.authorization || "";
    if (!authorization.startsWith("Bearer ")) return res.status(401).json({ success: false, message: "Authentication required" });

    const token = authorization.substring(7).trim();
    if (!token) return res.status(401).json({ success: false, message: "Authentication token missing" });

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user) return res.status(401).json({ success: false, message: "Invalid or expired session" });

    const user = authData.user;
    const { data: profile, error: profileError } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();

    if (profileError || !profile) return res.status(403).json({ success: false, message: "Administrator profile not found" });
    if (!isAdminValue(profile.is_admin)) return res.status(403).json({ success: false, message: "Administrator access required" });
    if (isSuspendedValue(profile.is_suspended)) return res.status(403).json({ success: false, message: "Administrator account is suspended" });

    req.user = user;
    req.profile = profile;
    req.accessToken = token;
    next();
  } catch (error) {
    return res.status(500).json({ success: false, message: "Admin authentication failed" });
  }
}

/* =====================================================
   ADMIN — SUSPEND / ACTIVATE USER ACCOUNT
===================================================== */

app.patch("/api/admin/users/:userId/account-status", authenticateAdmin, async (req, res) => {
    try {
      const { userId } = req.params;
      const { status } = req.body || {};

      if (!userId) return res.status(400).json({ success: false, message: "User ID is required" });
      if (status !== "active" && status !== "suspended") return res.status(400).json({ success: false, message: "Status must be active or suspended" });

      const { data: account, error: accountError } = await supabase
        .from("accounts")
        .update({ status: status })
        .eq("user_id", userId)
        .eq("account_type", "checking")
        .select("id, user_id, account_number, account_type, status")
        .maybeSingle();

      if (accountError) return res.status(500).json({ success: false, message: "Unable to update account status", error: accountError.message });
      if (!account) return res.status(404).json({ success: false, message: "Checking account not found" });

      return res.status(200).json({
        success: true,
        message: status === "suspended" ? "User account suspended successfully" : "User account activated successfully",
        account: account
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to update account status" });
    }
});

/* =====================================================
   CUSTOMER SUPPORT CHAT
===================================================== */

app.get("/support/messages/:userId", authenticate, async (req, res) => {
    try {
      const { userId } = req.params;
      if (req.user.id !== userId) return res.status(403).json({ success: false, message: "Unauthorized" });

      const { data, error } = await supabase.from("support_messages").select("*").eq("user_id", userId).order("created_at", { ascending: true });

      if (error) return res.status(500).json({ success: false, message: "Unable to load messages", error: error.message });
      return res.json({ success: true, messages: data || [] });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to load messages" });
    }
});

app.post("/support/messages", authenticate, async (req, res) => {
    try {
      const { user_id, message } = req.body || {};
      if (!user_id || !message || !String(message).trim()) return res.status(400).json({ success: false, message: "Message is required" });
      if (req.user.id !== user_id) return res.status(403).json({ success: false, message: "Unauthorized" });

      const { data: existingConversation, error: conversationError } = await supabase.from("support_conversations").select("id").eq("user_id", user_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (conversationError) return res.status(500).json({ success: false, message: "Unable to find support conversation", error: conversationError.message });

      let conversationId = existingConversation?.id;
      if (!conversationId) {
        const { data: newConversation, error: createConversationError } = await supabase.from("support_conversations").insert({ user_id: user_id, subject: "Support Request", status: "open" }).select("id").single();
        if (createConversationError) return res.status(500).json({ success: false, message: "Unable to create support conversation", error: createConversationError.message });
        conversationId = newConversation.id;
      }

      const { data, error } = await supabase.from("support_messages").insert({
          conversation_id: conversationId,
          sender_type: "customer",
          sender_id: user_id,
          message: String(message).trim(),
          created_at: new Date().toISOString(),
          is_read: false,
          sender: "user",
          user_id: user_id
        }).select("*").single();

      if (error) return res.status(500).json({ success: false, message: "Unable to send support message", error: error.message });
      return res.json({ success: true, message: data });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to send support message" });
    }
});

/* =====================================================
   ADMIN SUPPORT
===================================================== */

app.get(["/admin/users", "/api/admin/users"], authenticateAdmin, async (req, res) => {
    try {
      const { data: profiles, error: profilesError } = await supabase.from("profiles").select("*");
      if (profilesError) return res.status(500).json({ success: false, message: "Unable to load user profiles", error: profilesError.message });

      const { data: accounts, error: accountsError } = await supabase.from("accounts").select("*");
      if (accountsError) return res.status(500).json({ success: false, message: "Unable to load accounts", error: accountsError.message });

      const { data: balances, error: balancesError } = await supabase.from("account_balances").select("*");
      if (balancesError) return res.status(500).json({ success: false, message: "Unable to load account balances", error: balancesError.message });

      let authUsers = [];
      try {
        for (let page = 1; page <= 20; page++) {
          const { data: authData, error: authError } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
          if (authError) break;
          const pageUsers = authData?.users || [];
          authUsers = authUsers.concat(pageUsers);
          if (pageUsers.length < 1000) break;
        }
      } catch (error) { console.error(error); }

      const authMap = new Map(authUsers.map(u => [u.id, u]));
      const accountsByUser = new Map();
      (accounts || []).forEach(account => {
        if (!account.user_id) return;
        if (!accountsByUser.has(account.user_id)) accountsByUser.set(account.user_id, []);
        accountsByUser.get(account.user_id).push(account);
      });

      const balanceMap = new Map((balances || []).map(b => [b.account_id, b]));

      const users = (profiles || []).filter(profile => !isAdminValue(profile.is_admin)).map(profile => {
          const authUser = authMap.get(profile.id);
          const userAccounts = accountsByUser.get(profile.id) || [];
          const account = userAccounts.find(item => String(item.account_type || "").toLowerCase() === "checking") || userAccounts[0] || null;
          const accountBalance = account ? balanceMap.get(account.id) : null;
          const fullName = `${profile.first_name || ""} ${profile.surname || ""}`.trim() || "Unnamed User";
          const balance = Number(accountBalance?.available_balance ?? accountBalance?.balance ?? 0);

          return {
            id: profile.id,
            full_name: fullName,
            first_name: profile.first_name || "",
            surname: profile.surname || "",
            email: authUser?.email || profile.email || "No email",
            phone: profile.phone || "",
            avatar_url: getProfileAvatarUrl(profile.avatar_path),
            balance,
            account,
            account_balance: accountBalance,
            accounts: userAccounts
          };
        });

      return res.json({ success: true, users });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to load users", error: error.message });
    }
});

app.get(["/admin/support/messages/:userId", "/api/admin/support/messages/:userId"], authenticateAdmin, async (req, res) => {
    try {
      const { userId } = req.params;
      const { data, error } = await supabase.from("support_messages").select("*").eq("user_id", userId).order("created_at", { ascending: true });
      if (error) return res.status(500).json({ success: false, message: "Unable to load support messages: " + error.message });
      return res.json({ success: true, messages: data || [] });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to load support messages" });
    }
});

app.post(["/admin/support/messages", "/api/admin/support/messages"], authenticateAdmin, async (req, res) => {
    try {
      const { user_id, message } = req.body || {};
      if (!user_id || !message || !String(message).trim()) return res.status(400).json({ success: false, message: "Message is required" });

      const { data: customer } = await supabase.from("profiles").select("id, is_admin").eq("id", user_id).maybeSingle();
      if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });
      if (isAdminValue(customer.is_admin)) return res.status(400).json({ success: false, message: "Invalid support customer" });

      const { data: existingMessage } = await supabase.from("support_messages").select("conversation_id").eq("user_id", user_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!existingMessage?.conversation_id) return res.status(404).json({ success: false, message: "No support conversation exists for this customer" });

      const { data, error } = await supabase.from("support_messages").insert({
          conversation_id: existingMessage.conversation_id,
          sender_type: "admin",
          sender_id: req.user.id,
          message: String(message).trim(),
          created_at: new Date().toISOString(),
          is_read: false,
          sender: "admin",
          user_id: user_id
        }).select("*").single();

      if (error) return res.status(500).json({ success: false, message: "Unable to send support reply", error: error.message });

      try { await supabase.from("notifications").insert({ user_id: user_id, title: "New Support Message", message: "You have received a new message from Crest United Bank Support.", type: "system" }); } catch (error) { console.error(error); }

      return res.json({ success: true, message: data });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to send support reply" });
    }
});

app.put(["/admin/support/messages/:userId/read", "/api/admin/support/messages/:userId/read"], authenticateAdmin, async (req, res) => {
    try {
      await supabase.from("support_messages").update({ is_read: true }).eq("user_id", req.params.userId).eq("sender", "user").eq("is_read", false);
      return res.json({ success: true, message: "Messages marked as read" });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to mark messages as read" });
    }
});

/* =====================================================
   REGISTER
===================================================== */

app.post("/api/auth/register", async (req, res) => {
    let createdUserId = null;
    let createdAccountId = null;

    try {
      const { fname, sname, email, ssn, phone, pass, cpass, country, state, city, address, terms } = req.body || {};
      const cleanEmail = String(email || "").trim().toLowerCase();
      const cleanFirstName = String(fname || "").trim();
      const cleanSurname = String(sname || "").trim();
      const cleanPhone = String(phone || "").trim();
      const cleanCountry = String(country || "").trim();
      const cleanState = String(state || "").trim();
      const cleanCity = String(city || "").trim();
      const cleanAddress = String(address || "").trim();

      if (!cleanFirstName || !cleanSurname || !cleanEmail || !cleanPhone || !pass || !cpass || !cleanCountry || !cleanState || !cleanCity || !cleanAddress) {
        return res.status(400).json({ success: false, message: "All required fields must be provided" });
      }
      if (!isAccepted(terms)) return res.status(400).json({ success: false, message: "You must accept the terms and conditions" });
      if (pass !== cpass) return res.status(400).json({ success: false, message: "Passwords do not match" });
      if (String(pass).length < 8) return res.status(400).json({ success: false, message: "Password must be at least 8 characters" });

      const { data: authData, error: authError } = await supabase.auth.admin.createUser({ email: cleanEmail, password: pass, email_confirm: true });
      if (authError || !authData?.user) return res.status(400).json({ success: false, message: authError?.message || "Unable to create account" });
      createdUserId = authData.user.id;

      const { error: profileError } = await supabase.from("profiles").insert({ id: createdUserId, first_name: cleanFirstName, surname: cleanSurname, phone: cleanPhone, ssn: ssn ? String(ssn).trim() : null, is_admin: false });
      if (profileError) {
        await cleanupRegistration(createdUserId);
        return res.status(500).json({ success: false, message: "Unable to create customer profile", error: profileError.message });
      }

      const { error: addressError } = await supabase.from("customer_addresses").insert({ user_id: createdUserId, country: cleanCountry, state: cleanState, city: cleanCity, house_address: cleanAddress });
      if (addressError) {
        await cleanupRegistration(createdUserId);
        return res.status(500).json({ success: false, message: "Unable to save customer address", error: addressError.message });
      }

      const accountNumber = await generateAccountNumber();
      const { data: account, error: accountError } = await supabase.from("accounts").insert({ user_id: createdUserId, account_number: accountNumber, account_type: "checking", currency: "USD", status: "active" }).select().single();
      if (accountError || !account) {
        await cleanupRegistration(createdUserId);
        return res.status(500).json({ success: false, message: "Unable to create bank account", error: accountError?.message });
      }
      createdAccountId = account.id;

      const { error: balanceError } = await supabase.from("account_balances").insert({ account_id: account.id, available_balance: 0, ledger_balance: 0 });
      if (balanceError) {
        await cleanupRegistration(createdUserId, createdAccountId);
        return res.status(500).json({ success: false, message: "Unable to create account balance", error: balanceError.message });
      }

      try {
        const cardDetails = generateCardDetails();
        const { error: cardError } = await supabase.from("cards").insert({
            user_id: createdUserId,
            account_id: account.id,
            card_number: cardDetails.card_number,
            last_four: cardDetails.last_four,
            expiry_month: cardDetails.expiry_month,
            expiry_year: cardDetails.expiry_year,
            cvv: cardDetails.cvv,
            card_type: "debit",
            brand: "Visa",
            status: "active",
            balance: 0
          });
        if (cardError) throw new Error(`Database failed to create card: ${cardError.message}`);
      } catch (cardException) { throw cardException; }

      try { await supabase.from("budgets").insert({ user_id: createdUserId, monthly_limit: 5000.00 }); } catch (error) { console.error(error); }
      try { await supabase.from("customer_consents").insert({ user_id: createdUserId, consent_type: "terms", version: "1.0" }); } catch (error) { console.error(error); }
      try { await supabase.from("customer_consents").insert({ user_id: createdUserId, consent_type: "privacy", version: "1.0" }); } catch (error) { console.error(error); }
      try { await supabase.from("notifications").insert({ user_id: createdUserId, title: "Welcome to Crest United Bank", message: "Your Crest United Bank account has been created successfully.", type: "account" }); } catch (error) { console.error(error); }

      return res.status(201).json({ success: true, message: "Registration successful", user_id: createdUserId, account_number: accountNumber, user: { id: createdUserId, email: cleanEmail } });
    } catch (error) {
      if (createdUserId) await cleanupRegistration(createdUserId, createdAccountId);
      return res.status(500).json({ success: false, message: error.message || "Unable to complete registration" });
    }
});

/* =====================================================
   LOGIN
===================================================== */

app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body || {};
      const cleanEmail = String(email || "").trim().toLowerCase();

      if (!cleanEmail || !password) return res.status(400).json({ success: false, message: "Email and password are required" });

      const authClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      const { data, error } = await authClient.auth.signInWithPassword({ email: cleanEmail, password });

      if (error || !data?.user || !data?.session) return res.status(401).json({ success: false, message: "Invalid email or password" });

      const { data: profile, error: profileError } = await supabase.from("profiles").select("id, first_name, surname, phone, is_admin, avatar_path, savings_pin_hash").eq("id", data.user.id).maybeSingle();
      if (profileError) return res.status(500).json({ success: false, message: "Unable to verify account", error: profileError.message });
      if (!profile) return res.status(403).json({ success: false, message: "User profile not found" });

      profile.avatar_url = getProfileAvatarUrl(profile.avatar_path);

      return res.json({
        success: true,
        message: "Login successful",
        session: data.session,
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        token: data.session.access_token,
        expires_at: data.session.expires_at,
        expires_in: data.session.expires_in,
        user: data.user,
        profile,
        is_admin: isAdminValue(profile.is_admin)
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to login" });
    }
});

/* =====================================================
   CURRENT USER
===================================================== */

app.get("/api/auth/me", authenticate, async (req, res) => {
    try {
      const userId = req.user.id;
      const { data: profile, error: profileError } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
      if (profileError) return res.status(500).json({ success: false, message: "Unable to load profile", error: profileError.message });
      if (!profile) return res.status(404).json({ success: false, message: "Profile not found" });

      profile.avatar_url = getProfileAvatarUrl(profile.avatar_path);

      let address = null;
      try {
        const result = await supabase.from("customer_addresses").select("*").eq("user_id", userId).limit(1);
        if (!result.error) address = result.data?.[0] || null;
      } catch (error) { console.error(error); }

      const { data: accounts, error: accountsError } = await supabase.from("accounts").select("*").eq("user_id", userId);
      if (accountsError) return res.status(500).json({ success: false, message: "Unable to load accounts", error: accountsError.message });

      const accountList = accounts || [];
      const accountIds = accountList.map(account => account.id).filter(Boolean);

      let balances = [];
      if (accountIds.length > 0) {
        const { data, error } = await supabase.from("account_balances").select("*").in("account_id", accountIds);
        if (error) return res.status(500).json({ success: false, message: "Unable to load account balances", error: error.message });
        balances = data || [];
      }

      const balanceMap = new Map(balances.map(b => [b.account_id, b]));
      const accountListWithBalances = accountList.map(account => ({ ...account, account_balances: balanceMap.has(account.id) ? [balanceMap.get(account.id)] : [] }));

      const checkingAccount = accountListWithBalances.find(a => String(a.account_type || "").toLowerCase() === "checking");
      const savingsAccount = accountListWithBalances.find(a => ["savings", "saving"].includes(String(a.account_type || "").toLowerCase()));

      const checkingBalance = Number(checkingAccount?.account_balances?.[0]?.available_balance ?? 0);
      const savingsBalance = Number(savingsAccount?.account_balances?.[0]?.available_balance ?? 0);

      let cards = [];
      try {
        const result = await supabase.from("cards").select("*").eq("user_id", userId).order("created_at", { ascending: false });
        if (!result.error) cards = result.data || [];
      } catch (error) { console.error(error); }

      const cardBalance = Number(cards[0]?.balance ?? 0);

      return res.json({
        success: true,
        user: req.user,
        profile,
        address,
        accounts: accountListWithBalances,
        cards,
        balances: { checking: checkingBalance, savings: savingsBalance, card: cardBalance }
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to load user" });
    }
});

/* =====================================================
   SAVINGS — PIN SETUP, OTP & TRANSFERS
===================================================== */

// 1. Send OTP for PIN change
app.post("/api/savings/send-pin-otp", authenticate, async (req, res) => {
  try {
    const code = crypto.randomInt(100000, 1000000).toString();
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    const expiresAt = new Date(Date.now() + CODE_EXPIRY).toISOString();

    const { error } = await supabase.from("pin_verifications").insert({
      user_id: req.user.id,
      code_hash: codeHash,
      expires_at: expiresAt,
      attempts: 0
    });

    if (error) {
      console.error("DB ERROR SAVING OTP:", error);
      return res.status(500).json({ success: false, message: "Database failed to save OTP." });
    }

    if (SEND_TRANSFER_OTP_EMAIL) {
      try {
        await resend.emails.send({
          from: "Crest United Bank <onboarding@resend.dev>",
          to: req.user.email,
          subject: "Crest United Bank — PIN Change Code",
          html: `
            <div style="font-family:Arial,sans-serif;line-height:1.6;">
              <h2>Crest United Bank</h2>
              <p>You requested to change your Savings PIN. Use the code below to confirm:</p>
              <div style="font-size:32px;font-weight:bold;letter-spacing:8px;margin:20px 0;">${code}</div>
              <p>This code expires in 10 minutes. If you did not request this, contact support immediately.</p>
            </div>
          `
        });
      } catch (err) { console.error("RESEND EMAIL ERROR:", err); }
    }

    return res.json({ success: true, message: "OTP sent" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to send OTP" });
  }
});

// 2. Verify OTP & Save PIN
app.post("/api/savings/confirm-pin-otp", authenticate, async (req, res) => {
  try {
    const { pin, otp } = req.body || {};
    if (!pin || String(pin).length !== 4) return res.status(400).json({ success: false, message: "Invalid PIN" });
    if (!otp || String(otp).length !== 6) return res.status(400).json({ success: false, message: "Invalid OTP" });

    const { data: verification } = await supabase.from("pin_verifications")
      .select("*")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!verification) return res.status(400).json({ success: false, message: "No OTP found" });
    if (new Date(verification.expires_at).getTime() < Date.now()) return res.status(400).json({ success: false, message: "OTP expired" });

    const otpHash = crypto.createHash("sha256").update(String(otp)).digest("hex");
    if (otpHash !== verification.code_hash) {
      await supabase.from("pin_verifications").update({ attempts: verification.attempts + 1 }).eq("id", verification.id);
      return res.status(401).json({ success: false, message: "Incorrect OTP code" });
    }

    const pinHash = crypto.createHash("sha256").update(String(pin)).digest("hex");
    const { error } = await supabase.from("profiles").update({ savings_pin_hash: pinHash }).eq("id", req.user.id);
    if (error) throw error;

    await supabase.from("pin_verifications").delete().eq("id", verification.id);

    return res.json({ success: true, message: "PIN updated successfully" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to verify OTP" });
  }
});

// 3. Verify PIN (Used when unlocking the Savings modal)
app.post("/api/savings/verify-pin", authenticate, async (req, res) => {
  try {
    const { pin } = req.body || {};
    if (!pin) return res.status(400).json({ success: false, message: "PIN required" });

    const { data: profile } = await supabase.from("profiles").select("savings_pin_hash").eq("id", req.user.id).maybeSingle();
    if (!profile || !profile.savings_pin_hash) return res.status(400).json({ success: false, message: "No PIN set" });

    const pinHash = crypto.createHash("sha256").update(String(pin)).digest("hex");
    if (pinHash !== profile.savings_pin_hash) return res.status(401).json({ success: false, message: "Incorrect PIN" });

    return res.json({ success: true, message: "PIN verified" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to verify PIN" });
  }
});

// 4. Transfer between Savings and Checking
app.post("/api/savings/transfer", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount, direction } = req.body || {}; // "to_savings" or "to_checking"
    const transferAmount = Number(amount);

    if (!Number.isFinite(transferAmount) || transferAmount <= 0) return res.status(400).json({ success: false, message: "Invalid amount" });

    const { data: accounts } = await supabase.from("accounts").select("*").eq("user_id", userId);
    const checkingAcc = accounts.find(a => a.account_type === "checking");
    const savingsAcc = accounts.find(a => a.account_type === "savings");

    if (!checkingAcc || !savingsAcc) return res.status(404).json({ success: false, message: "Account not found" });

    const { data: balances } = await supabase.from("account_balances").select("*").in("account_id", [checkingAcc.id, savingsAcc.id]);
    const checkingBal = balances.find(b => b.account_id === checkingAcc.id);
    const savingsBal = balances.find(b => b.account_id === savingsAcc.id);

    const currentChecking = Number(checkingBal?.available_balance || 0);
    const currentSavings = Number(savingsBal?.available_balance || 0);

    if (direction === "to_savings" && currentChecking < transferAmount) return res.status(400).json({ success: false, message: "Insufficient checking balance" });
    if (direction === "to_checking" && currentSavings < transferAmount) return res.status(400).json({ success: false, message: "Insufficient savings balance" });

    const newChecking = direction === "to_savings" ? currentChecking - transferAmount : currentChecking + transferAmount;
    const newSavings = direction === "to_savings" ? currentSavings + transferAmount : currentSavings - transferAmount;

    await supabase.from("account_balances").update({ available_balance: newChecking }).eq("account_id", checkingAcc.id);
    await supabase.from("account_balances").update({ available_balance: newSavings }).eq("account_id", savingsAcc.id);

    // LOG ONLY ONE TRANSACTION to prevent duplicates in history
    const isToSavings = direction === "to_savings";
    await supabase.from("transactions").insert({
      user_id: userId,
      account_id: checkingAcc.id,
      account_number: checkingAcc.account_number,
      amount: transferAmount,
      type: isToSavings ? "Transfer to Savings" : "Transfer from Savings",
      direction: isToSavings ? "out" : "in",
      description: isToSavings ? "Transfer to Savings Account" : "Transfer from Savings Account",
      status: "completed",
      reference: generateReference("TRF")
    });

    return res.json({ success: true, message: "Transfer successful", newChecking, newSavings });
  } catch (error) {
    console.error("SAVINGS TRANSFER ERROR:", error);
    return res.status(500).json({ success: false, message: "Unable to complete transfer" });
  }
});

/* =====================================================
   ACCOUNTS
===================================================== */

app.get("/api/accounts", authenticate, async (req, res) => {
    try {
      const { data: accounts, error: accountsError } = await supabase.from("accounts").select("*").eq("user_id", req.user.id);
      if (accountsError) return res.status(500).json({ success: false, message: accountsError.message });

      const accountList = accounts || [];
      const accountIds = accountList.map(account => account.id).filter(Boolean);

      let balances = [];
      if (accountIds.length) {
        const { data, error } = await supabase.from("account_balances").select("*").in("account_id", accountIds);
        if (error) return res.status(500).json({ success: false, message: error.message });
        balances = data || [];
      }

      const balanceMap = new Map(balances.map(b => [b.account_id, b]));
      const result = accountList.map(account => ({ ...account, account_balances: balanceMap.has(account.id) ? [balanceMap.get(account.id)] : [] }));

      return res.json({ success: true, accounts: result });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to load accounts" });
    }
});

app.get("/api/accounts/:id", authenticate, async (req, res) => {
    try {
      const { data: account, error: accountError } = await supabase.from("accounts").select("*").eq("id", req.params.id).eq("user_id", req.user.id).maybeSingle();
      if (accountError || !account) return res.status(404).json({ success: false, message: "Account not found" });

      const { data: balance, error: balanceError } = await supabase.from("account_balances").select("*").eq("account_id", account.id).maybeSingle();
      if (balanceError) return res.status(500).json({ success: false, message: balanceError.message });

      return res.json({ success: true, account: { ...account, account_balances: balance ? [balance] : [] } });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to load account" });
    }
});

/* =====================================================
   TRANSACTIONS
===================================================== */

app.get("/api/transactions", authenticate, async (req, res) => {
    try {
      const { data, error } = await supabase.from("transactions").select("*").eq("user_id", req.user.id).order("created_at", { ascending: false });
      if (error) return res.status(500).json({ success: false, message: error.message });

      const { data: transfers } = await supabase.from("transfers").select("id, reference, amount, recipient_name, recipient_bank_name, recipient_account_number, recipient_swift_code, recipient_routing_number, description, created_at, status").eq("sender_user_id", req.user.id);

      const enrichedTransactions = (data || []).map(tx => {
        const matchingTransfer = (transfers || []).find(t => {
          const txTime = new Date(tx.created_at).getTime();
          const trfTime = new Date(t.created_at).getTime();
          const timeDiff = Math.abs(txTime - trfTime);
          const sameAmount = Math.abs(Number(tx.amount) - Number(t.amount)) < 0.01;
          return sameAmount && timeDiff < 60000;
        });

        if (matchingTransfer) {
          return {
            ...tx,
            recipient_name: matchingTransfer.recipient_name || tx.recipient_name,
            recipient_bank_name: matchingTransfer.recipient_bank_name || tx.recipient_bank_name,
            recipient_account_number: matchingTransfer.recipient_account_number || tx.recipient_account_number,
            recipient_swift_code: matchingTransfer.recipient_swift_code || tx.recipient_swift_code,
            recipient_routing_number: matchingTransfer.recipient_routing_number || tx.recipient_routing_number,
            description: matchingTransfer.description || tx.description,
            reference: matchingTransfer.reference || tx.reference
          };
        }
        return tx;
      });

      return res.json({ success: true, transactions: enrichedTransactions });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to load transactions" });
    }
});

/* =====================================================
   BENEFICIARIES
===================================================== */

app.get("/api/beneficiaries", authenticate, async (req, res) => {
    try {
      const { data, error } = await supabase.from("beneficiaries").select("*").eq("user_id", req.user.id).order("created_at", { ascending: false });
      if (error) return res.status(500).json({ success: false, message: error.message });
      return res.json({ success: true, beneficiaries: data || [] });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to load beneficiaries" });
    }
});

app.post("/api/beneficiaries", authenticate, async (req, res) => {
    try {
      const { name, bank_name, account_identifier, account_type } = req.body || {};
      if (!name || !bank_name || !account_identifier) return res.status(400).json({ success: false, message: "Required beneficiary information is missing" });

      const { data, error } = await supabase.from("beneficiaries").insert({
          user_id: req.user.id,
          name: String(name).trim(),
          bank_name: String(bank_name).trim(),
          account_identifier: String(account_identifier).trim(),
          account_type: account_type || "checking"
        }).select().single();

      if (error) return res.status(400).json({ success: false, message: error.message });
      return res.status(201).json({ success: true, message: "Beneficiary added", beneficiary: data });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to create beneficiary" });
    }
});

app.delete("/api/beneficiaries/:id", authenticate, async (req, res) => {
    try {
      const { error } = await supabase.from("beneficiaries").delete().eq("id", req.params.id).eq("user_id", req.user.id);
      if (error) return res.status(400).json({ success: false, message: error.message });
      return res.json({ success: true, message: "Beneficiary deleted" });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to delete beneficiary" });
    }
});

/* =====================================================
   TRANSFERS
===================================================== */

app.post("/api/transfers", authenticate, async (req, res) => {
    try {
      const { recipient_name, recipient_bank_name, recipient_swift_code, recipient_routing_number, recipient_account_number, amount, description } = req.body || {};

      if (!recipient_name || !recipient_bank_name || !recipient_swift_code || !recipient_routing_number || !recipient_account_number || amount === undefined || amount === null) {
        return res.status(400).json({ success: false, message: "All recipient banking details and amount are required" });
      }

      const transferAmount = Number(amount);
      if (!Number.isFinite(transferAmount) || transferAmount <= 0) return res.status(400).json({ success: false, message: "Invalid transfer amount" });

      const { data: account, error: accountError } = await supabase.from("accounts").select("*").eq("user_id", req.user.id).eq("account_type", "checking").in("status", ["active", "suspended"]).limit(1).maybeSingle();
      if (accountError || !account) return res.status(404).json({ success: false, message: "Active checking account not found" });
      if (account.status === "suspended") return res.status(403).json({ success: false, message: "Your account is currently suspended." });

      const { data: balance, error: balanceError } = await supabase.from("account_balances").select("*").eq("account_id", account.id).maybeSingle();
      if (balanceError || !balance) return res.status(404).json({ success: false, message: "Account balance not found" });
      if (Number(balance.available_balance) < transferAmount) return res.status(400).json({ success: false, message: "Insufficient funds" });

      const TRANSFER_LIMIT = 5000000;
      const now = new Date();
      const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
      const startOfNextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0)).toISOString();

      const { data: monthlyTransfers, error: limitError } = await supabase.from("transfers").select("amount").eq("sender_user_id", req.user.id).eq("status", "completed").gte("created_at", startOfMonth).lt("created_at", startOfNextMonth);
      if (limitError) return res.status(500).json({ success: false, message: "Unable to verify transfer limits." });

      const totalSentThisMonth = (monthlyTransfers || []).reduce((sum, tx) => sum + Number(tx.amount), 0);
      if (totalSentThisMonth + transferAmount > TRANSFER_LIMIT) {
        return res.status(400).json({ success: false, message: `Transfer limit exceeded. You have $${(TRANSFER_LIMIT - totalSentThisMonth).toLocaleString()} remaining for this month.` });
      }

      const reference = generateReference("TRF");
      const { data: transfer, error: transferError } = await supabase.from("transfers").insert({
          sender_user_id: req.user.id,
          sender_account_id: account.id,
          amount: transferAmount,
          currency: account.currency || "USD",
          reference,
          status: "pending",
          description: description || "",
          recipient_name: String(recipient_name).trim(),
          recipient_bank_name: String(recipient_bank_name).trim(),
          recipient_swift_code: String(recipient_swift_code).trim().toUpperCase(),
          recipient_routing_number: String(recipient_routing_number).trim(),
          recipient_account_number: String(recipient_account_number).trim()
        }).select().single();

      if (transferError) return res.status(400).json({ success: false, message: "Unable to initiate transfer" });

      const verificationCode = crypto.randomInt(100000, 1000000).toString();
      const codeHash = crypto.createHash("sha256").update(verificationCode).digest("hex");
      const expiresAt = new Date(Date.now() + CODE_EXPIRY).toISOString();

      const { error: verificationError } = await supabase.from("transfer_verifications").insert({ user_id: req.user.id, transfer_id: transfer.id, code_hash: codeHash, expires_at: expiresAt, attempts: 0 });
      if (verificationError) {
        await supabase.from("transfers").delete().eq("id", transfer.id);
        return res.status(500).json({ success: false, message: "Unable to create transfer verification" });
      }

      if (SEND_TRANSFER_OTP_EMAIL) {
        try {
          await resend.emails.send({
            from: "Crest United Bank <onboarding@resend.dev>",
            to: req.user.email,
            subject: "Crest United Bank Transfer Verification",
            html: `<div style="font-family:Arial,sans-serif;line-height:1.6;"><h2>Crest United Bank</h2><p>Your transfer verification code is:</p><div style="font-size:32px;font-weight:bold;letter-spacing:8px;margin:20px 0;">${verificationCode}</div><p>This code expires in 10 minutes.</p><p>If you did not request this transfer, please contact Crest United Bank Support immediately.</p></div>`
          });
        } catch (emailError) { console.error("TRANSFER OTP EMAIL ERROR:", emailError); }
      }

      return res.status(201).json({
        success: true,
        message: "Transfer verification required",
        transfer: {
          id: transfer.id,
          reference: transfer.reference,
          amount: transfer.amount,
          currency: transfer.currency,
          status: transfer.status,
          description: transfer.description || `External transfer to ${transfer.recipient_bank_name} (${transfer.recipient_account_number})`,
          recipient_name: transfer.recipient_name,
          recipient_bank_name: transfer.recipient_bank_name,
          recipient_account_number: transfer.recipient_account_number,
          recipient_swift_code: transfer.recipient_swift_code,
          recipient_routing_number: transfer.recipient_routing_number
        },
        verification: { required: true, expires_at: expiresAt }
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to process transfer" });
    }
});

app.post("/api/transfers/verify", authenticate, async (req, res) => {
    try {
      const { transfer_id, code } = req.body || {};
      if (!transfer_id || !code) return res.status(400).json({ success: false, message: "Transfer ID and verification code are required" });

      const verificationCode = String(code).trim();
      if (!/^\d{6}$/.test(verificationCode)) return res.status(400).json({ success: false, message: "Verification code must be 6 digits" });

      const { data: transfer, error: transferError } = await supabase.from("transfers").select("*").eq("id", transfer_id).eq("sender_user_id", req.user.id).maybeSingle();
      if (transferError || !transfer) return res.status(404).json({ success: false, message: "Transfer not found" });
      if (transfer.status !== "pending") return res.status(400).json({ success: false, message: "This transfer is no longer awaiting verification" });

      const { data: verification, error: verificationError } = await supabase.from("transfer_verifications").select("*").eq("transfer_id", transfer_id).eq("user_id", req.user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (verificationError || !verification) return res.status(404).json({ success: false, message: "Transfer verification not found" });
      if (verification.verified_at) return res.status(400).json({ success: false, message: "This verification code has already been used" });
      if (Number(verification.attempts) >= 5) return res.status(429).json({ success: false, message: "Too many incorrect attempts. Please request a new verification code." });

      const expiresAt = new Date(verification.expires_at).getTime();
      if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return res.status(400).json({ success: false, message: "Verification code has expired" });

      const submittedHash = crypto.createHash("sha256").update(verificationCode).digest("hex");
      const codeMatches = crypto.timingSafeEqual(Buffer.from(submittedHash, "utf8"), Buffer.from(verification.code_hash, "utf8"));

      if (!codeMatches) {
        await supabase.from("transfer_verifications").update({ attempts: Number(verification.attempts) + 1 }).eq("id", verification.id);
        return res.status(400).json({ success: false, message: "Incorrect verification code" });
      }

      const now = new Date().toISOString();

      const { data: senderAcc } = await supabase.from("accounts").select("id").eq("user_id", req.user.id).eq("account_type", "checking").maybeSingle();
      const { data: senderBal } = await supabase.from("account_balances").select("available_balance").eq("account_id", senderAcc.id).maybeSingle();
      
      await supabase.from("account_balances").update({ available_balance: Number(senderBal.available_balance) - Number(transfer.amount), updated_at: now }).eq("account_id", senderAcc.id);

      await supabase.from("transactions").insert({
        user_id: req.user.id,
        account_id: senderAcc.id,
        amount: transfer.amount,
        type: "Transfer Out",
        direction: "out",
        description: transfer.description || `External transfer to ${transfer.recipient_bank_name} (${transfer.recipient_account_number})`,
        status: "completed",
        recipient_name: transfer.recipient_name,
        recipient_bank_name: transfer.recipient_bank_name,
        recipient_account_number: transfer.recipient_account_number,
        recipient_swift_code: transfer.recipient_swift_code,
        recipient_routing_number: transfer.recipient_routing_number
      });

      await supabase.from("transfer_verifications").update({ verified_at: now }).eq("id", verification.id);
      const { data: updatedTransfer } = await supabase.from("transfers").update({ status: "completed" }).eq("id", transfer_id).select().single();

      return res.status(200).json({
        success: true,
        message: "Transfer verification successful",
        transfer: {
          id: updatedTransfer.id,
          reference: updatedTransfer.reference,
          amount: updatedTransfer.amount,
          currency: updatedTransfer.currency,
          status: updatedTransfer.status,
          created_at: updatedTransfer.created_at,
          description: updatedTransfer.description || `External transfer to ${updatedTransfer.recipient_bank_name} (${updatedTransfer.recipient_account_number})`,
          recipient_name: updatedTransfer.recipient_name,
          recipient_bank_name: updatedTransfer.recipient_bank_name,
          recipient_account_number: updatedTransfer.recipient_account_number,
          recipient_swift_code: updatedTransfer.recipient_swift_code,
          recipient_routing_number: updatedTransfer.recipient_routing_number
        }
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to verify transfer" });
    }
});

/* =====================================================
   CARDS
===================================================== */

app.get("/api/cards", authenticate, async (req, res) => {
    try {
      const { data: existingCards, error: fetchError } = await supabase.from("cards").select("*").eq("user_id", req.user.id).order("created_at", { ascending: false });
      if (fetchError) return res.status(500).json({ success: false, message: fetchError.message });
      if (existingCards && existingCards.length > 0) return res.json({ success: true, cards: existingCards });

      const { data: account } = await supabase.from("accounts").select("id").eq("user_id", req.user.id).eq("account_type", "checking").maybeSingle();
      if (!account) return res.status(404).json({ success: false, message: "No checking account found to attach card to" });

      const cardDetails = generateCardDetails();
      const { data: newCard, error: createError } = await supabase.from("cards").insert({
          user_id: req.user.id,
          account_id: account.id,
          card_number: cardDetails.card_number,
          last_four: cardDetails.last_four,
          expiry_month: cardDetails.expiry_month,
          expiry_year: cardDetails.expiry_year,
          cvv: cardDetails.cvv,
          card_type: "debit",
          brand: "Visa",
          status: "active",
          balance: 0
        }).select().single();

      if (createError) return res.status(500).json({ success: false, message: "Failed to create card", error: createError.message });
      return res.json({ success: true, cards: [newCard] });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to load cards" });
    }
});

/* =====================================================
   NOTIFICATIONS
===================================================== */

app.get("/api/notifications", authenticate, async (req, res) => {
    try {
      const { data, error } = await supabase.from("notifications").select("*").eq("user_id", req.user.id).order("created_at", { ascending: false });
      if (error) return res.status(500).json({ success: false, message: error.message });
      return res.json({ success: true, notifications: data || [] });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to load notifications" });
    }
});

app.patch("/api/notifications/:id/read", authenticate, async (req, res) => {
    try {
      const { data, error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", req.params.id).eq("user_id", req.user.id).select().maybeSingle();
      if (error || !data) return res.status(404).json({ success: false, message: "Notification not found" });
      return res.json({ success: true, notification: data });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to update notification" });
    }
});

/* =====================================================
   ADMIN STATS
===================================================== */

app.get("/api/admin/stats", authenticateAdmin, async (req, res) => {
    try {
      const { count: users } = await supabase.from("profiles").select("*", { count: "exact", head: true }).eq("is_admin", false);
      const { count: accounts } = await supabase.from("accounts").select("*", { count: "exact", head: true });
      const { count: pendingWithdrawals } = await supabase.from("withdrawals").select("*", { count: "exact", head: true }).eq("status", "pending");
      const { count: pendingTransfers } = await supabase.from("transfers").select("*", { count: "exact", head: true }).in("status", ["pending", "processing"]);

      return res.json({
        success: true,
        stats: {
          users: users || 0,
          accounts: accounts || 0,
          pending_withdrawals: pendingWithdrawals || 0,
          pending_transfers: pendingTransfers || 0
        }
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to load admin statistics", error: error.message });
    }
});

/* =====================================================
   ADMIN SINGLE USER
===================================================== */

app.get("/api/admin/users/:id", authenticateAdmin, async (req, res) => {
    try {
      const userId = req.params.id;
      const { data: profile, error: profileError } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
      if (profileError || !profile) return res.status(404).json({ success: false, message: "User not found" });

      let authUser = null;
      try { const { data } = await supabase.auth.admin.getUserById(userId); authUser = data?.user || null; } catch (error) { console.error(error); }

      let address = null;
      try { const { data } = await supabase.from("customer_addresses").select("*").eq("user_id", userId).limit(1); address = data?.[0] || null; } catch (error) { console.error(error); }

      const { data: accounts, error: accountsError } = await supabase.from("accounts").select("*").eq("user_id", userId);
      if (accountsError) return res.status(500).json({ success: false, message: accountsError.message });

      const accountList = accounts || [];
      const accountIds = accountList.map(account => account.id).filter(Boolean);

      let balances = [];
      if (accountIds.length) {
        const { data } = await supabase.from("account_balances").select("*").in("account_id", accountIds);
        balances = data || [];
      }

      const balanceMap = new Map(balances.map(b => [b.account_id, b]));
      const accountsWithBalances = accountList.map(account => ({ ...account, account_balances: balanceMap.has(account.id) ? [balanceMap.get(account.id)] : [] }));

      let cards = [];
      try { const result = await supabase.from("cards").select("*").eq("user_id", userId); if (!result.error) cards = result.data || []; } catch (error) { console.error(error); }

      const checkingAccount = accountsWithBalances.find(a => String(a.account_type || "").toLowerCase() === "checking");
      const savingsAccount = accountsWithBalances.find(a => ["savings", "saving"].includes(String(a.account_type || "").toLowerCase()));

      const checkingBalance = Number(checkingAccount?.account_balances?.[0]?.available_balance ?? 0);
      const savingsBalance = Number(savingsAccount?.account_balances?.[0]?.available_balance ?? 0);
      const cardBalance = Number(cards[0]?.balance ?? 0);
      const fullName = [profile.first_name, profile.surname].filter(Boolean).join(" ").trim();

      return res.json({
        success: true,
        profile: {
          ...profile,
          avatar_url: getProfileAvatarUrl(profile.avatar_path),
          full_name: fullName || "Unnamed User",
          email: authUser?.email || profile.email || "No email"
        },
        address,
        accounts: accountsWithBalances,
        cards,
        balances: { checking: checkingBalance, savings: savingsBalance, card: cardBalance }
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to load user", error: error.message });
    }
});

/* =====================================================
   ADMIN BALANCE UPDATE
===================================================== */

app.put("/api/admin/users/:id/balances", authenticateAdmin, async (req, res) => {
    try {
      const userId = req.params.id;
      const { checking_balance, savings_balance, card_balance } = req.body || {};

      const checking = Number(checking_balance);
      const savings = Number(savings_balance);
      const card = Number(card_balance);

      if (!Number.isFinite(checking) || !Number.isFinite(savings) || !Number.isFinite(card)) return res.status(400).json({ success: false, message: "Invalid balance amount" });
      if (checking < 0 || savings < 0 || card < 0) return res.status(400).json({ success: false, message: "Balance cannot be negative" });

      const { data: profile, error: profileError } = await supabase.from("profiles").select("id, is_admin").eq("id", userId).maybeSingle();
      if (profileError || !profile) return res.status(404).json({ success: false, message: "User not found" });
      if (isAdminValue(profile.is_admin)) return res.status(403).json({ success: false, message: "Administrator balances cannot be modified here" });

      const { data: accounts, error: accountsError } = await supabase.from("accounts").select("*").eq("user_id", userId);
      if (accountsError) return res.status(500).json({ success: false, message: accountsError.message });

      const checkingAccount = (accounts || []).find(account => String(account.account_type || "").toLowerCase() === "checking");
      let savingsAccount = (accounts || []).find(account => ["savings", "saving"].includes(String(account.account_type || "").toLowerCase()));

      if (!checkingAccount) return res.status(400).json({ success: false, message: "Checking account not found" });

      const { data: existingCheckingBalance } = await supabase.from("account_balances").select("*").eq("account_id", checkingAccount.id).maybeSingle();
      if (existingCheckingBalance) {
        await supabase.from("account_balances").update({ available_balance: checking, ledger_balance: checking, updated_at: new Date().toISOString() }).eq("account_id", checkingAccount.id);
      } else {
        await supabase.from("account_balances").insert({ account_id: checkingAccount.id, available_balance: checking, ledger_balance: checking });
      }

      if (savingsAccount) {
        const { data: existingSavingsBalance } = await supabase.from("account_balances").select("*").eq("account_id", savingsAccount.id).maybeSingle();
        if (existingSavingsBalance) {
          await supabase.from("account_balances").update({ available_balance: savings, ledger_balance: savings, updated_at: new Date().toISOString() }).eq("account_id", savingsAccount.id);
        } else {
          await supabase.from("account_balances").insert({ account_id: savingsAccount.id, available_balance: savings, ledger_balance: savings });
        }
      } else {
        const accountNumber = await generateAccountNumber();
        const { data: newSavings, error: savingsAccountError } = await supabase.from("accounts").insert({ user_id: userId, account_number: accountNumber, account_type: "savings", currency: "USD", status: "active" }).select().single();
        if (savingsAccountError || !newSavings) return res.status(500).json({ success: false, message: savingsAccountError?.message || "Unable to create savings account" });

        savingsAccount = newSavings;
        await supabase.from("account_balances").insert({ account_id: newSavings.id, available_balance: savings, ledger_balance: savings });
      }

      const { data: existingCard } = await supabase.from("cards").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (existingCard) {
        await supabase.from("cards").update({ balance: card, updated_at: new Date().toISOString() }).eq("id", existingCard.id);
      } else {
        await supabase.from("cards").insert({ user_id: userId, account_id: checkingAccount.id, balance: card, card_type: "debit", brand: "Visa", last_four: "0000", status: "active" });
      }

      return res.json({ success: true, message: "User balances updated successfully", balances: { checking, savings, card } });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to update user balances", error: error.message });
    }
});

/* =====================================================
   ADMIN — DEPOSIT FUNDS
===================================================== */

async function handleAdminDeposit(req, res) {
  try {
    const userId = req.params.id;
    const { account_type, amount, depositor_name, description, note, reference: clientReference } = req.body || {};

    const type = String(account_type || "checking").trim().toLowerCase();
    const depositAmount = Number(amount);
    const depositorName = String(depositor_name || "").trim();
    const cleanNote = String(note || "").trim();
    const cleanDescription = String(description || "").trim() || `Deposit from ${depositorName}`;

    if (!["checking", "savings", "card"].includes(type)) return res.status(400).json({ success: false, message: "account_type must be checking, savings, or card" });
    if (!Number.isFinite(depositAmount) || depositAmount <= 0) return res.status(400).json({ success: false, message: "Amount must be a number greater than zero" });
    if (depositAmount > 100000000) return res.status(400).json({ success: false, message: "Amount is too large" });
    if (depositorName.length < 2) return res.status(400).json({ success: false, message: "Depositor name is required (min 2 characters)" });
    if (depositorName.length > 80) return res.status(400).json({ success: false, message: "Depositor name is too long (max 80 characters)" });

    const { data: profile, error: profileError } = await supabase.from("profiles").select("id, is_admin").eq("id", userId).maybeSingle();
    if (profileError || !profile) return res.status(404).json({ success: false, message: "User not found" });
    if (isAdminValue(profile.is_admin)) return res.status(403).json({ success: false, message: "Administrator accounts cannot be deposited into here" });

    const { data: accounts, error: accountsError } = await supabase.from("accounts").select("*").eq("user_id", userId);
    if (accountsError) return res.status(500).json({ success: false, message: accountsError.message });

    const accountList = accounts || [];
    let targetAccount = null;

    if (type === "checking") {
      targetAccount = accountList.find(a => String(a.account_type || "").toLowerCase() === "checking");
    } else if (type === "savings") {
      targetAccount = accountList.find(a => ["savings", "saving"].includes(String(a.account_type || "").toLowerCase()));
    }

    if (!targetAccount) return res.status(404).json({ success: false, message: `${type} account not found for this user` });

    const reference = String(clientReference || "").trim() || generateReference("DEP");

    const transactionRow = {
      user_id: userId,
      account_id: targetAccount.id,
      account_number: targetAccount.account_number,
      amount: depositAmount,
      type: "Deposit",
      direction: "in",
      description: cleanDescription,
      status: "completed",
      reference: reference,
      depositor_name: depositorName,
      note: cleanNote || null,
      account_type: type,
      created_by: "admin",
      recipient_name: depositorName
    };

    const { data: savedTransaction, error: txError } = await supabase.from("transactions").insert(transactionRow).select().single();

    if (txError) {
      console.error("ADMIN DEPOSIT TX INSERT ERROR:", txError);
      if (txError.message.includes("account_number")) {
          delete transactionRow.account_number;
          const { data: retryTx, error: retryError } = await supabase.from("transactions").insert(transactionRow).select().single();
          if (retryError) return res.status(500).json({ success: false, message: "Unable to save deposit receipt: " + retryError.message });
          
          try { await supabase.from("notifications").insert({ user_id: userId, title: "Deposit Received", message: `${formatMoneyServer(depositAmount)} was deposited into your ${type} account by ${depositorName}. Ref: ${reference}`, type: "transaction" }); } catch (e) {}

          return res.status(201).json({ success: true, message: "Deposit recorded successfully", reference: reference, transaction: retryTx });
      }
      return res.status(500).json({ success: false, message: "Unable to save deposit receipt: " + txError.message, error: txError.message });
    }

    try { await supabase.from("notifications").insert({ user_id: userId, title: "Deposit Received", message: `${formatMoneyServer(depositAmount)} was deposited into your ${type} account by ${depositorName}. Ref: ${reference}`, type: "transaction" }); } catch (notifyError) { console.error("ADMIN DEPOSIT NOTIFICATION ERROR:", notifyError); }

    return res.status(201).json({ success: true, message: "Deposit recorded successfully", reference: reference, transaction: savedTransaction });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to process deposit", error: error.message });
  }
}

app.post("/api/admin/users/:id/deposits", authenticateAdmin, handleAdminDeposit);
app.post("/api/admin/users/:id/transactions", authenticateAdmin, handleAdminDeposit);

/* =====================================================
   PROFILE PHOTO UPLOAD
===================================================== */

app.post("/api/profile/photo", authenticate, async (req, res) => {
    try {
      const { image } = req.body || {};
      if (!image || typeof image !== "string") return res.status(400).json({ success: false, message: "Profile photo is required" });

      const match = image.match(/^data:(image\/jpeg|image\/jpg|image\/png|image\/webp);base64,(.+)$/);
      if (!match) return res.status(400).json({ success: false, message: "Invalid profile photo format" });

      const imageBuffer = Buffer.from(match[2], "base64");
      if (!imageBuffer.length) return res.status(400).json({ success: false, message: "Profile photo is empty" });
      if (imageBuffer.length > PROFILE_PHOTO_MAX_BYTES) return res.status(400).json({ success: false, message: "Profile photo must be smaller than 1.5MB" });

      const avatarPath = `${req.user.id}/avatar.jpg`;
      const { error: uploadError } = await supabase.storage.from(PROFILE_PHOTO_BUCKET).upload(avatarPath, imageBuffer, { contentType: "image/jpeg", cacheControl: "3600", upsert: true });
      if (uploadError) return res.status(500).json({ success: false, message: "Unable to upload profile photo" });

      const avatarUrl = getProfileAvatarUrl(avatarPath);
      const { error: profileUpdateError } = await supabase.from("profiles").update({ avatar_path: avatarPath, avatar_url: avatarUrl }).eq("id", req.user.id);
      if (profileUpdateError) return res.status(500).json({ success: false, message: "Photo uploaded but profile could not be updated" });

      return res.status(200).json({ success: true, message: "Profile photo updated successfully", avatar_url: avatarUrl, avatar_path: avatarPath });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to update profile photo" });
    }
});

app.delete("/api/profile/photo", authenticate, async (req, res) => {
    try {
      const { data: profile } = await supabase.from("profiles").select("avatar_path").eq("id", req.user.id).maybeSingle();
      if (profile?.avatar_path) {
        const { error: storageError } = await supabase.storage.from(PROFILE_PHOTO_BUCKET).remove([profile.avatar_path]);
        if (storageError) return res.status(500).json({ success: false, message: "Unable to remove profile photo" });
      }

      await supabase.from("profiles").update({ avatar_path: null, avatar_url: null }).eq("id", req.user.id);
      return res.json({ success: true, message: "Profile photo removed successfully" });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to remove profile photo" });
    }
});

/* =====================================================
   DASHBOARD SUMMARY & BUDGET
===================================================== */

app.get("/api/dashboard/summary", authenticate, async (req, res) => {
    try {
      const userId = req.user.id;
      const now = new Date();
      const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
      const startOfNextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0)).toISOString();

      const { data: currentTransactions } = await supabase.from("transactions").select("amount, type, direction").eq("user_id", userId).gte("created_at", startOfMonth).lt("created_at", startOfNextMonth);

      function isDebit(tx) {
        const direction = String(tx?.direction || "").toLowerCase();
        if (["in", "incoming", "credit"].includes(direction)) return false;
        if (["out", "outgoing", "debit"].includes(direction)) return true;
        const type = String(tx?.type || "").toLowerCase();
        if (type.includes("deposit") || type.includes("credit") || type.includes("received")) return false;
        return true;
      }

      const spendingThisMonth = (currentTransactions || []).reduce((total, tx) => !isDebit(tx) ? total : total + Math.abs(Number(tx.amount) || 0), 0);

      return res.json({
        success: true,
        spending: { this_month: Number(spendingThisMonth.toFixed(2)) },
        period: { month_label: now.toLocaleDateString("en-US", { month: "long" }) }
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to load dashboard summary" });
    }
});

app.patch("/api/dashboard/budget", authenticate, async (req, res) => {
    try {
      const userId = req.user.id;
      const { monthly_limit } = req.body || {};
      const parsed = Number(monthly_limit);

      if (!Number.isFinite(parsed) || parsed < 0) return res.status(400).json({ success: false, message: "monthly_limit must be a non-negative number" });

      const { data: existing } = await supabase.from("budgets").select("id").eq("user_id", userId).maybeSingle();
      let savedBudget = null;

      if (existing) {
        const { data } = await supabase.from("budgets").update({ monthly_limit: parsed, updated_at: new Date().toISOString() }).eq("id", existing.id).select().single();
        savedBudget = data;
      } else {
        const { data } = await supabase.from("budgets").insert({ user_id: userId, monthly_limit: parsed }).select().single();
        savedBudget = data;
      }

      return res.json({ success: true, message: "Budget updated successfully", budget: { monthly_limit: Number(savedBudget.monthly_limit) } });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to update budget" });
    }
});

/* =====================================================
   404 & ERROR HANDLER
===================================================== */

app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
});

app.use((error, req, res, next) => {
  console.error("UNHANDLED SERVER ERROR:", error);
  if (res.headersSent) return next(error);
  res.status(500).json({ success: false, message: "Internal server error", error: error.message });
});

app.listen(PORT, () => {
  console.log(`Crest United Bank API running on port ${PORT}`);
});