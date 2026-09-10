require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");
const supabase = require("./supabase");
const app = express();
const resend = new Resend(
  process.env.RESEND_API_KEY
);
const CODE_EXPIRY =
  10 * 60 * 1000;
// Email sending disabled until
// your sending domain is ready.
const SEND_TRANSFER_OTP_EMAIL = true;

/* =====================================================
   CONFIG
===================================================== */

const PORT = process.env.PORT || 5000;

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "WARNING: SUPABASE_SERVICE_ROLE_KEY is missing"
  );
}

console.log(
  "SERVICE ROLE KEY LOADED:",
  !!process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* =====================================================
   MIDDLEWARE
===================================================== */

app.use(
  cors({
    origin: true,
    credentials: true,
    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS"
    ],
    allowedHeaders: [
      "Content-Type",
      "Authorization"
    ]
  })
);

app.use(
  express.json({
    limit: "2mb"
  })
);

/* =====================================================
   BASIC
===================================================== */

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Sterling One Bank API is running"
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "API healthy",
    timestamp: new Date().toISOString()
  });
});

/* =====================================================
   SUPABASE TEST
===================================================== */

app.get(
  "/api/test-supabase",
  async (req, res) => {
    try {
      const { error } =
        await supabase
          .from("profiles")
          .select("id")
          .limit(1);

      if (error) {
        console.error(
          "SUPABASE TEST ERROR:",
          error
        );

        return res.status(500).json({
          success: false,
          message:
            "Supabase connection failed",
          error: error.message
        });
      }

      return res.json({
        success: true,
        message:
          "Supabase connection successful"
      });
    } catch (error) {
      console.error(
        "SUPABASE TEST EXCEPTION:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Internal server error",
        error: error.message
      });
    }
  }
);

/* =====================================================
   HELPERS
===================================================== */

function generateReference(prefix = "STL") {
  return `${prefix}-${Date.now()}-${crypto
    .randomBytes(4)
    .toString("hex")
    .toUpperCase()}`;
}

function isAdminValue(value) {
  if (value === true) return true;
  if (value === 1) return true;
  if (value === "1") return true;

  return (
    String(value || "")
      .trim()
      .toLowerCase() === "true"
  );
}

function isSuspendedValue(value) {
  if (value === true) return true;
  if (value === 1) return true;
  if (value === "1") return true;

  return (
    String(value || "")
      .trim()
      .toLowerCase() === "true"
  );
}

function isAccepted(value) {
  if (value === true) return true;
  if (value === 1) return true;

  const normalized = String(
    value ?? ""
  )
    .trim()
    .toLowerCase();

  return (
    normalized === "true" ||
    normalized === "1" ||
    normalized === "on" ||
    normalized === "yes"
  );
}

/* =====================================================
   ACCOUNT NUMBER
===================================================== */

async function generateAccountNumber() {
  for (let attempt = 0; attempt < 50; attempt++) {
    const number =
      "4" +
      crypto.randomInt(
        100000000,
        1000000000
      );

    const {
      data,
      error
    } =
      await supabase
        .from("accounts")
        .select("id")
        .eq(
          "account_number",
          number
        )
        .limit(1);

    if (error) {
      console.error(
        "ACCOUNT NUMBER CHECK ERROR:",
        error
      );

      throw new Error(
        "Unable to generate account number"
      );
    }

    if (
      !data ||
      data.length === 0
    ) {
      return number;
    }
  }

  throw new Error(
    "Unable to generate unique account number"
  );
}

/* =====================================================
   REGISTRATION CLEANUP
===================================================== */

async function cleanupRegistration(
  userId,
  accountId = null
) {
  if (!userId) return;

  try {
    if (accountId) {
      const { error } =
        await supabase
          .from("account_balances")
          .delete()
          .eq(
            "account_id",
            accountId
          );

      if (error) {
        console.error(
          "CLEANUP BALANCE ERROR:",
          error
        );
      }
    }
  } catch (error) {
    console.error(
      "CLEANUP BALANCE EXCEPTION:",
      error
    );
  }

  try {
    if (accountId) {
      const { error } =
        await supabase
          .from("accounts")
          .delete()
          .eq(
            "id",
            accountId
          )
          .eq(
            "user_id",
            userId
          );

      if (error) {
        console.error(
          "CLEANUP ACCOUNT ERROR:",
          error
        );
      }
    }
  } catch (error) {
    console.error(
      "CLEANUP ACCOUNT EXCEPTION:",
      error
    );
  }

  try {
    const { error } =
      await supabase
        .from("customer_addresses")
        .delete()
        .eq(
          "user_id",
          userId
        );

    if (error) {
      console.error(
        "CLEANUP ADDRESS ERROR:",
        error
      );
    }
  } catch (error) {
    console.error(
      "CLEANUP ADDRESS EXCEPTION:",
      error
    );
  }

  try {
    const { error } =
      await supabase
        .from("customer_consents")
        .delete()
        .eq(
          "user_id",
          userId
        );

    if (error) {
      console.error(
        "CLEANUP CONSENT ERROR:",
        error
      );
    }
  } catch (error) {
    console.error(
      "CLEANUP CONSENT EXCEPTION:",
      error
    );
  }

  try {
    const { error } =
      await supabase
        .from("notifications")
        .delete()
        .eq(
          "user_id",
          userId
        );

    if (error) {
      console.error(
        "CLEANUP NOTIFICATION ERROR:",
        error
      );
    }
  } catch (error) {
    console.error(
      "CLEANUP NOTIFICATION EXCEPTION:",
      error
    );
  }

  try {
    const { error } =
      await supabase
        .from("profiles")
        .delete()
        .eq(
          "id",
          userId
        );

    if (error) {
      console.error(
        "CLEANUP PROFILE ERROR:",
        error
      );
    }
  } catch (error) {
    console.error(
      "CLEANUP PROFILE EXCEPTION:",
      error
    );
  }

  try {
    const { error } =
      await supabase.auth.admin.deleteUser(
        userId
      );

    if (error) {
      console.error(
        "CLEANUP AUTH USER ERROR:",
        error
      );
    }
  } catch (error) {
    console.error(
      "CLEANUP AUTH USER EXCEPTION:",
      error
    );
  }
}

/* =====================================================
   AUTHENTICATION
===================================================== */

async function authenticate(
  req,
  res,
  next
) {
  try {
    const authorization =
      req.headers.authorization || "";

    if (
      !authorization.startsWith(
        "Bearer "
      )
    ) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication required"
      });
    }

    const token =
      authorization
        .substring(7)
        .trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication token missing"
      });
    }

    const {
      data,
      error
    } =
      await supabase.auth.getUser(
        token
      );

    if (
      error ||
      !data?.user
    ) {
      console.error(
        "AUTHENTICATION ERROR:",
        error
      );

      return res.status(401).json({
        success: false,
        message:
          "Invalid or expired session"
      });
    }

    req.user =
      data.user;

    req.accessToken =
      token;

    next();
  } catch (error) {
    console.error(
      "AUTHENTICATION EXCEPTION:",
      error
    );

    return res.status(401).json({
      success: false,
      message:
        "Authentication failed"
    });
  }
}

/* =====================================================
   ADMIN AUTHENTICATION
===================================================== */

async function authenticateAdmin(
  req,
  res,
  next
) {
  try {
    const authorization =
      req.headers.authorization || "";

    if (
      !authorization.startsWith(
        "Bearer "
      )
    ) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication required"
      });
    }

    const token =
      authorization
        .substring(7)
        .trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication token missing"
      });
    }

    const {
      data: authData,
      error: authError
    } =
      await supabase.auth.getUser(
        token
      );

    if (
      authError ||
      !authData?.user
    ) {
      console.error(
        "ADMIN AUTH ERROR:",
        authError
      );

      return res.status(401).json({
        success: false,
        message:
          "Invalid or expired session"
      });
    }

    const user =
      authData.user;

    const {
      data: profile,
      error: profileError
    } =
      await supabase
        .from("profiles")
        .select("*")
        .eq(
          "id",
          user.id
        )
        .maybeSingle();

    if (profileError) {
      console.error(
        "ADMIN PROFILE ERROR:",
        profileError
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to verify administrator profile",
        error:
          profileError.message
      });
    }

    if (!profile) {
      return res.status(403).json({
        success: false,
        message:
          "Administrator profile not found"
      });
    }

    if (
      !isAdminValue(
        profile.is_admin
      )
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Administrator access required"
      });
    }

    if (
      isSuspendedValue(
        profile.is_suspended
      )
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Administrator account is suspended"
      });
    }

    req.user =
      user;

    req.profile =
      profile;

    req.accessToken =
      token;

    next();
  } catch (error) {
    console.error(
      "ADMIN AUTH EXCEPTION:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Admin authentication failed"
    });
  }
}

/* =====================================================
   ADMIN — SUSPEND / ACTIVATE USER ACCOUNT
===================================================== */
app.patch(
  "/api/admin/users/:userId/account-status",
  authenticateAdmin,
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { status } = req.body || {};
      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "User ID is required"
        });
      }
      if (
        status !== "active" &&
        status !== "suspended"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Status must be active or suspended"
        });
      }
      const {
        data: account,
        error: accountError
      } = await supabase
        .from("accounts")
        .update({
          status: status
        })
        .eq("user_id", userId)
        .eq("account_type", "checking")
        .select("id, user_id, account_number, account_type, status")
        .maybeSingle();
      if (accountError) {
        console.error(
          "ACCOUNT STATUS UPDATE ERROR:",
          accountError
        );
        return res.status(500).json({
          success: false,
          message:
            "Unable to update account status",
          error:
            accountError.message
        });
      }
      if (!account) {
        return res.status(404).json({
          success: false,
          message:
            "Checking account not found"
        });
      }
      return res.status(200).json({
        success: true,
        message:
          status === "suspended"
            ? "User account suspended successfully"
            : "User account activated successfully",
        account: account
      });
    } catch (error) {
      console.error(
        "ACCOUNT STATUS UPDATE EXCEPTION:",
        error
      );
      return res.status(500).json({
        success: false,
        message:
          "Unable to update account status"
      });
    }
  }
);

/* =====================================================
   CUSTOMER SUPPORT CHAT
   CURRENT SUPPORT SYSTEM
===================================================== */

/*
   Customer loads their own messages
*/

app.get(
  "/support/messages/:userId",
  authenticate,
  async (req, res) => {
    try {
      const {
        userId
      } = req.params;

      if (
        req.user.id !==
        userId
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Unauthorized"
        });
      }

      const {
        data,
        error
      } =
        await supabase
          .from(
            "support_messages"
          )
          .select("*")
          .eq(
            "user_id",
            userId
          )
          .order(
            "created_at",
            {
              ascending:
                true
            }
          );

      if (error) {
        console.error(
          "SUPPORT LOAD ERROR:",
          error
        );

        return res.status(500).json({
          success: false,
          message:
            "Unable to load messages",
          error:
            error.message
        });
      }

      return res.json({
        success: true,
        messages:
          data || []
      });
    } catch (error) {
      console.error(
        "SUPPORT GET ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load messages"
      });
    }
  }
);

/*
   Customer sends message
*/

app.post(
  "/support/messages",
  authenticate,
  async (req, res) => {
    try {
      const {
        user_id,
        message
      } = req.body || {};

      if (
        !user_id ||
        !message ||
        !String(message).trim()
      ) {
        return res.status(400).json({
          success: false,
          message: "Message is required"
        });
      }

      // Make sure the authenticated user can only send
      // messages for their own account.
      if (req.user.id !== user_id) {
        return res.status(403).json({
          success: false,
          message: "Unauthorized"
        });
      }

      // Find the user's existing conversation.
      const {
  data: existingConversation,
  error: conversationError
} = await supabase
  .from("support_conversations")
  .select("id")
  .eq("user_id", user_id)
  .order("created_at", {
    ascending: false
  })
  .limit(1)
  .maybeSingle();

if (conversationError) {
  console.error(
    "SUPPORT CONVERSATION ERROR:",
    conversationError
  );

  return res.status(500).json({
    success: false,
    message:
      "Unable to find support conversation",
    error:
      conversationError.message
  });
}

let conversationId =
  existingConversation?.id;

if (!conversationId) {
  const {
    data: newConversation,
    error: createConversationError
  } = await supabase
    .from("support_conversations")
    .insert({
      user_id: user_id,
      subject: "Support Request",
      status: "open"
    })
    .select("id")
    .single();

  if (createConversationError) {
    console.error(
      "CREATE SUPPORT CONVERSATION ERROR:",
      createConversationError
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to create support conversation",
      error:
        createConversationError.message
    });
  }

  conversationId =
    newConversation.id;
}

      const {
        data,
        error
      } = await supabase
        .from("support_messages")
        .insert({
          conversation_id:
            conversationId,

          sender_type:
  "customer",

          sender_id:
            user_id,

          message:
            String(message).trim(),

          created_at:
            new Date().toISOString(),

          is_read:
            false,

          sender:
            "user",

          user_id:
            user_id
        })
        .select("*")
        .single();

      if (error) {
        console.error(
          "SUPPORT SEND ERROR:",
          error
        );

        return res.status(500).json({
          success: false,
          message:
            "Unable to send support message",
          error:
            error.message
        });
      }

      return res.json({
        success: true,
        message: data
      });

    } catch (error) {
      console.error(
        "SUPPORT POST ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to send support message",
        error:
          error.message
      });
    }
  }
);


/* =====================================================
   ADMIN SUPPORT
===================================================== */

/*
   Admin loads all users for support.
   Supports both the current admin page path
   and the API path.
*/

app.get(
  [
    "/admin/users",
    "/api/admin/users"
  ],
  authenticateAdmin,
  async (req, res) => {
    try {
      const {
        data: profiles,
        error: profilesError
      } =
        await supabase
          .from("profiles")
          .select("*");

      if (profilesError) {
        console.error(
          "ADMIN USERS PROFILE ERROR:",
          profilesError
        );

        return res.status(500).json({
          success: false,
          message:
            "Unable to load user profiles",
          error:
            profilesError.message
        });
      }

      const {
        data: accounts,
        error: accountsError
      } =
        await supabase
          .from("accounts")
          .select("*");

      if (accountsError) {
        return res.status(500).json({
          success: false,
          message:
            "Unable to load accounts",
          error:
            accountsError.message
        });
      }

      const {
        data: balances,
        error: balancesError
      } =
        await supabase
          .from(
            "account_balances"
          )
          .select("*");

      if (balancesError) {
        return res.status(500).json({
          success: false,
          message:
            "Unable to load account balances",
          error:
            balancesError.message
        });
      }

      let authUsers = [];

      try {
        for (
          let page = 1;
          page <= 20;
          page++
        ) {
          const {
            data: authData,
            error: authError
          } =
            await supabase.auth.admin
              .listUsers({
                page,
                perPage: 1000
              });

          if (authError) {
            console.error(
              "ADMIN AUTH USERS ERROR:",
              authError
            );

            break;
          }

          const pageUsers =
            authData?.users || [];

          authUsers =
            authUsers.concat(
              pageUsers
            );

          if (
            pageUsers.length <
            1000
          ) {
            break;
          }
        }
      } catch (error) {
        console.error(
          "ADMIN AUTH USERS EXCEPTION:",
          error
        );
      }

      const authMap =
        new Map();

      authUsers.forEach(
        user => {
          authMap.set(
            user.id,
            user
          );
        }
      );

      const accountsByUser =
        new Map();

      (
        accounts || []
      ).forEach(
        account => {
          if (
            !account.user_id
          ) {
            return;
          }

          if (
            !accountsByUser.has(
              account.user_id
            )
          ) {
            accountsByUser.set(
              account.user_id,
              []
            );
          }

          accountsByUser
            .get(
              account.user_id
            )
            .push(account);
        }
      );

      const balanceMap =
        new Map();

      (
        balances || []
      ).forEach(
        balance => {
          if (
            balance.account_id
          ) {
            balanceMap.set(
              balance.account_id,
              balance
            );
          }
        }
      );

      const users =
        (profiles || [])
          .filter(
            profile =>
              !isAdminValue(
                profile.is_admin
              )
          )
          .map(
            profile => {
              const authUser =
                authMap.get(
                  profile.id
                );

              const userAccounts =
                accountsByUser.get(
                  profile.id
                ) || [];

              const account =
                userAccounts.find(
                  item =>
                    String(
                      item.account_type ||
                        ""
                    ).toLowerCase() ===
                    "checking"
                ) ||
                userAccounts[0] ||
                null;

              const accountBalance =
                account
                  ? balanceMap.get(
                      account.id
                    )
                  : null;

              const firstName =
                profile.first_name ||
                "";

              const surname =
                profile.surname ||
                "";

              const fullName =
                `${firstName} ${surname}`
                  .trim() ||
                "Unnamed User";

              const balance =
                Number(
                  accountBalance
                    ?.available_balance ??
                    accountBalance
                      ?.balance ??
                    0
                );

              return {
                id:
                  profile.id,

                full_name:
                  fullName,

                first_name:
                  firstName,

                surname:
                  surname,

                email:
                  authUser?.email ||
                  profile.email ||
                  "No email",

                phone:
                  profile.phone ||
                  "",

                balance,

                account,

                account_balance:
                  accountBalance,

                accounts:
                  userAccounts
              };
            }
          );

      return res.json({
        success: true,
        users
      });
    } catch (error) {
      console.error(
        "ADMIN USERS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load users",
        error:
          error.message
      });
    }
  }
);

/*
   Admin loads messages for one customer.
*/

app.get(
  [
    "/admin/support/messages/:userId",
    "/api/admin/support/messages/:userId"
  ],
  authenticateAdmin,
  async (req, res) => {
    try {
      const {
        userId
      } = req.params;

      if (!userId) {
        return res.status(400).json({
          success: false,
          message:
            "Customer ID is required"
        });
      }

      const {
        data,
        error
      } =
        await supabase
          .from("support_messages")
          .select("*")
          .eq(
            "user_id",
            userId
          )
          .order(
            "created_at",
            {
              ascending: true
            }
          );

      if (error) {
        console.error(
          "ADMIN SUPPORT LOAD ERROR:",
          error
        );

        return res.status(500).json({
          success: false,
          message:
            "Unable to load support messages: " +
            error.message,
          error:
            error.message,
          code:
            error.code || null,
          details:
            error.details || null,
          hint:
            error.hint || null
        });
      }

      return res.json({
        success: true,
        messages:
          data || []
      });

    } catch (error) {
      console.error(
        "ADMIN SUPPORT GET ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load support messages: " +
          error.message,
        error:
          error.message
      });
    }
  }
);



      /*
   Admin sends reply to customer.
*/

app.post(
  [
    "/admin/support/messages",
    "/api/admin/support/messages"
  ],
  authenticateAdmin,
  async (req, res) => {
    try {
      const {
        user_id,
        message
      } = req.body || {};

      if (
        !user_id ||
        !message ||
        !String(message).trim()
      ) {
        return res.status(400).json({
          success: false,
          message: "Message is required"
        });
      }

      // Verify customer exists and is not an admin.
      const {
        data: customer,
        error: customerError
      } = await supabase
        .from("profiles")
        .select("id, is_admin")
        .eq("id", user_id)
        .maybeSingle();

      if (customerError) {
        return res.status(500).json({
          success: false,
          message:
            customerError.message
        });
      }

      if (!customer) {
        return res.status(404).json({
          success: false,
          message:
            "Customer not found"
        });
      }

      if (
        isAdminValue(
          customer.is_admin
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid support customer"
        });
      }

      // Find the customer's existing conversation.
      const {
        data: existingMessage,
        error: conversationError
      } = await supabase
        .from("support_messages")
        .select("conversation_id")
        .eq("user_id", user_id)
        .order("created_at", {
          ascending: false
        })
        .limit(1)
        .maybeSingle();

      if (conversationError) {
        console.error(
          "ADMIN CONVERSATION ERROR:",
          conversationError
        );

        return res.status(500).json({
          success: false,
          message:
            "Unable to find support conversation",
          error:
            conversationError.message
        });
      }

      // Normally this already exists because the customer
      // started the conversation.
      if (!existingMessage?.conversation_id) {
        return res.status(404).json({
          success: false,
          message:
            "No support conversation exists for this customer"
        });
      }

      const conversationId =
        existingMessage.conversation_id;

      const adminId =
        req.user.id;

      const {
        data,
        error
      } = await supabase
        .from("support_messages")
        .insert({
          conversation_id:
            conversationId,

          sender_type:
            "admin",

          sender_id:
            adminId,

          message:
            String(message).trim(),

          created_at:
            new Date().toISOString(),

          is_read:
            false,

          sender:
            "admin",

          user_id:
            user_id
        })
        .select("*")
        .single();

      if (error) {
        console.error(
          "ADMIN SUPPORT SEND ERROR:",
          error
        );

        return res.status(500).json({
          success: false,
          message:
            "Unable to send support reply",
          error:
            error.message
        });
      }

      // Create notification for customer.
      try {
        const {
          error: notificationError
        } = await supabase
          .from("notifications")
          .insert({
            user_id:
              user_id,

            title:
              "New Support Message",

            message:
              "You have received a new message from Sterling One Bank Support.",

            type:
              "system"
          });

        if (notificationError) {
          console.error(
            "SUPPORT NOTIFICATION ERROR:",
            notificationError
          );
        }
      } catch (error) {
        console.error(
          "SUPPORT NOTIFICATION EXCEPTION:",
          error
        );
      }

      return res.json({
        success: true,
        message: data
      });

    } catch (error) {
      console.error(
        "ADMIN SUPPORT POST ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to send support reply",
        error:
          error.message
      });
    }
  }
);

/*
   Admin marks customer's messages as read.
*/

app.put(
  [
    "/admin/support/messages/:userId/read",
    "/api/admin/support/messages/:userId/read"
  ],
  authenticateAdmin,
  async (req, res) => {
    try {
      const {
        userId
      } = req.params;

      const {
        error
      } =
        await supabase
          .from(
            "support_messages"
          )
          .update({
            is_read:
              true
          })
          .eq(
            "user_id",
            userId
          )
          .eq(
            "sender",
            "user"
          )
          .eq(
            "is_read",
            false
          );

      if (error) {
        console.error(
          "ADMIN SUPPORT READ ERROR:",
          error
        );

        return res.status(500).json({
          success: false,
          message:
            "Unable to mark messages as read",
          error:
            error.message
        });
      }

      return res.json({
        success: true,
        message:
          "Messages marked as read"
      });
    } catch (error) {
      console.error(
        "ADMIN SUPPORT READ EXCEPTION:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to mark messages as read"
      });
    }
  }
);

/* =====================================================
   REGISTER
===================================================== */

app.post(
  "/api/auth/register",
  async (req, res) => {
    let createdUserId =
      null;

    let createdAccountId =
      null;

    try {
      const {
        fname,
        sname,
        email,
        ssn,
        phone,
        pass,
        cpass,
        country,
        state,
        city,
        address,
        terms
      } = req.body || {};

      const cleanEmail =
        String(email || "")
          .trim()
          .toLowerCase();

      const cleanFirstName =
        String(fname || "")
          .trim();

      const cleanSurname =
        String(sname || "")
          .trim();

      const cleanPhone =
        String(phone || "")
          .trim();

      const cleanCountry =
        String(country || "")
          .trim();

      const cleanState =
        String(state || "")
          .trim();

      const cleanCity =
        String(city || "")
          .trim();

      const cleanAddress =
        String(address || "")
          .trim();

      if (
        !cleanFirstName ||
        !cleanSurname ||
        !cleanEmail ||
        !cleanPhone ||
        !pass ||
        !cpass ||
        !cleanCountry ||
        !cleanState ||
        !cleanCity ||
        !cleanAddress
      ) {
        return res.status(400).json({
          success: false,
          message:
            "All required fields must be provided"
        });
      }

      if (!isAccepted(terms)) {
        return res.status(400).json({
          success: false,
          message:
            "You must accept the terms and conditions"
        });
      }

      if (pass !== cpass) {
        return res.status(400).json({
          success: false,
          message:
            "Passwords do not match"
        });
      }

      if (
        String(pass).length <
        8
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Password must be at least 8 characters"
        });
      }

      const {
        data: authData,
        error: authError
      } =
        await supabase.auth.admin
          .createUser({
            email:
              cleanEmail,

            password:
              pass,

            email_confirm:
              true
          });

      if (
        authError ||
        !authData?.user
      ) {
        console.error(
          "CREATE AUTH USER ERROR:",
          authError
        );

        return res.status(400).json({
          success: false,
          message:
            authError?.message ||
            "Unable to create account"
        });
      }

      createdUserId =
        authData.user.id;

      const {
        error: profileError
      } =
        await supabase
          .from("profiles")
          .insert({
            id:
              createdUserId,

            first_name:
              cleanFirstName,

            surname:
              cleanSurname,

            phone:
              cleanPhone,

            ssn:
              ssn
                ? String(
                    ssn
                  ).trim()
                : null,

            is_admin:
              false
          });

      if (profileError) {
        console.error(
          "PROFILE INSERT ERROR:",
          profileError
        );

        await cleanupRegistration(
          createdUserId
        );

        return res.status(500).json({
          success: false,
          message:
            "Unable to create customer profile",
          error:
            profileError.message
        });
      }

      const {
        error: addressError
      } =
        await supabase
          .from(
            "customer_addresses"
          )
          .insert({
            user_id:
              createdUserId,

            country:
              cleanCountry,

            state:
              cleanState,

            city:
              cleanCity,

            house_address:
              cleanAddress
          });

      if (addressError) {
        console.error(
          "ADDRESS INSERT ERROR:",
          addressError
        );

        await cleanupRegistration(
          createdUserId
        );

        return res.status(500).json({
          success: false,
          message:
            "Unable to save customer address",
          error:
            addressError.message
        });
      }

      const accountNumber =
        await generateAccountNumber();

      const {
        data: account,
        error: accountError
      } =
        await supabase
          .from("accounts")
          .insert({
            user_id:
              createdUserId,

            account_number:
              accountNumber,

            account_type:
              "checking",

            currency:
              "USD",

            status:
              "active"
          })
          .select()
          .single();

      if (
        accountError ||
        !account
      ) {
        console.error(
          "ACCOUNT CREATION ERROR:",
          accountError
        );

        await cleanupRegistration(
          createdUserId
        );

        return res.status(500).json({
          success: false,
          message:
            "Unable to create bank account",
          error:
            accountError?.message
        });
      }

      createdAccountId =
        account.id;

      const {
        error: balanceError
      } =
        await supabase
          .from(
            "account_balances"
          )
          .insert({
            account_id:
              account.id,

            available_balance:
              0,

            ledger_balance:
              0
          });

      if (balanceError) {
        console.error(
          "BALANCE CREATION ERROR:",
          balanceError
        );

        await cleanupRegistration(
          createdUserId,
          createdAccountId
        );

        return res.status(500).json({
          success: false,
          message:
            "Unable to create account balance",
          error:
            balanceError.message
        });
      }

      try {
        const {
          error
        } =
          await supabase
            .from(
              "customer_consents"
            )
            .insert({
              user_id:
                createdUserId,

              consent_type:
                "terms",

              version:
                "1.0"
            });

        if (error) {
          console.error(
            "TERMS CONSENT ERROR:",
            error
          );
        }
      } catch (error) {
        console.error(
          "TERMS CONSENT EXCEPTION:",
          error
        );
      }

      try {
        const {
          error
        } =
          await supabase
            .from(
              "customer_consents"
            )
            .insert({
              user_id:
                createdUserId,

              consent_type:
                "privacy",

              version:
                "1.0"
            });

        if (error) {
          console.error(
            "PRIVACY CONSENT ERROR:",
            error
          );
        }
      } catch (error) {
        console.error(
          "PRIVACY CONSENT EXCEPTION:",
          error
        );
      }

      try {
        const {
          error
        } =
          await supabase
            .from(
              "notifications"
            )
            .insert({
              user_id:
                createdUserId,

              title:
                "Welcome to Sterling One Bank",

              message:
                "Your Sterling One Bank account has been created successfully.",

              type:
                "account"
            });

        if (error) {
          console.error(
            "WELCOME NOTIFICATION ERROR:",
            error
          );
        }
      } catch (error) {
        console.error(
          "WELCOME NOTIFICATION EXCEPTION:",
          error
        );
      }

      return res.status(201).json({
        success: true,

        message:
          "Registration successful",

        user_id:
          createdUserId,

        account_number:
          accountNumber,

        user: {
          id:
            createdUserId,

          email:
            cleanEmail
        }
      });
    } catch (error) {
      console.error(
        "REGISTRATION ERROR:",
        error
      );

      if (createdUserId) {
        await cleanupRegistration(
          createdUserId,
          createdAccountId
        );
      }

      return res.status(500).json({
        success: false,
        message:
          error.message ||
          "Unable to complete registration"
      });
    }
  }
);

/* =====================================================
   LOGIN
===================================================== */

app.post(
  "/api/auth/login",
  async (req, res) => {
    try {
      const {
        email,
        password
      } = req.body || {};

      const cleanEmail =
        String(email || "")
          .trim()
          .toLowerCase();

      if (
        !cleanEmail ||
        !password
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Email and password are required"
        });
      }

      /*
         IMPORTANT:
         Use a separate auth client so
         signInWithPassword does not alter
         the global service-role client.
      */

      const authClient =
        createClient(
          process.env.SUPABASE_URL,
          process.env.SUPABASE_SERVICE_ROLE_KEY,
          {
            auth: {
              persistSession:
                false,

              autoRefreshToken:
                false,

              detectSessionInUrl:
                false
            }
          }
        );

      const {
        data,
        error
      } =
        await authClient.auth
          .signInWithPassword({
            email:
              cleanEmail,

            password
          });

      if (
        error ||
        !data?.user ||
        !data?.session
      ) {
        console.error(
          "LOGIN AUTH ERROR:",
          error
        );

        return res.status(401).json({
          success: false,
          message:
            "Invalid email or password"
        });
      }

      const user =
        data.user;

      const {
        data: profile,
        error: profileError
      } =
        await supabase
          .from("profiles")
          .select(
            "id, first_name, surname, phone, is_admin"
          )
          .eq(
            "id",
            user.id
          )
          .maybeSingle();

      if (profileError) {
        console.error(
          "LOGIN PROFILE ERROR:",
          profileError
        );

        return res.status(500).json({
          success: false,
          message:
            "Unable to verify account",
          error:
            profileError.message
        });
      }

      if (!profile) {
        return res.status(403).json({
          success: false,
          message:
            "User profile not found"
        });
      }

      const isAdmin =
        isAdminValue(
          profile.is_admin
        );

      return res.json({
        success: true,

        message:
          "Login successful",

        session:
          data.session,

        access_token:
          data.session
            .access_token,

        refresh_token:
          data.session
            .refresh_token,

        token:
          data.session
            .access_token,

        expires_at:
          data.session
            .expires_at,

        expires_in:
          data.session
            .expires_in,

        user,

        profile,

        is_admin:
          isAdmin
      });
    } catch (error) {
      console.error(
        "LOGIN ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to login",
        error:
          error.message
      });
    }
  }
);

/* =====================================================
   CURRENT USER
===================================================== */

app.get(
  "/api/auth/me",
  authenticate,
  async (req, res) => {
    try {
      const userId =
        req.user.id;

      const {
        data: profile,
        error: profileError
      } =
        await supabase
          .from("profiles")
          .select("*")
          .eq(
            "id",
            userId
          )
          .maybeSingle();

      if (profileError) {
        console.error(
          "ME PROFILE ERROR:",
          profileError
        );

        return res.status(500).json({
          success: false,
          message:
            "Unable to load profile",
          error:
            profileError.message
        });
      }

      if (!profile) {
        return res.status(404).json({
          success: false,
          message:
            "Profile not found"
        });
      }

      let address =
        null;

      try {
        const result =
          await supabase
            .from(
              "customer_addresses"
            )
            .select("*")
            .eq(
              "user_id",
              userId
            )
            .limit(1);

        if (!result.error) {
          address =
            result.data?.[0] ||
            null;
        }
      } catch (error) {
        console.error(
          "ME ADDRESS EXCEPTION:",
          error
        );
      }

      const {
        data: accounts,
        error: accountsError
      } =
        await supabase
          .from("accounts")
          .select("*")
          .eq(
            "user_id",
            userId
          );

      if (accountsError) {
        return res.status(500).json({
          success: false,
          message:
            "Unable to load accounts",
          error:
            accountsError.message
        });
      }

      const accountList =
        accounts || [];

      const accountIds =
        accountList
          .map(
            account =>
              account.id
          )
          .filter(Boolean);

      let balances =
        [];

      if (
        accountIds.length >
        0
      ) {
        const {
          data,
          error
        } =
          await supabase
            .from(
              "account_balances"
            )
            .select("*")
            .in(
              "account_id",
              accountIds
            );

        if (error) {
          return res.status(500).json({
            success: false,
            message:
              "Unable to load account balances",
            error:
              error.message
          });
        }

        balances =
          data || [];
      }

      const balanceMap =
        new Map();

      balances.forEach(
        balance => {
          balanceMap.set(
            balance.account_id,
            balance
          );
        }
      );

      const accountListWithBalances =
        accountList.map(
          account => ({
            ...account,

            account_balances:
              balanceMap.has(
                account.id
              )
                ? [
                    balanceMap.get(
                      account.id
                    )
                  ]
                : []
          })
        );

      const checkingAccount =
        accountListWithBalances.find(
          account =>
            String(
              account.account_type ||
                ""
            ).toLowerCase() ===
            "checking"
        );

      const savingsAccount =
        accountListWithBalances.find(
          account => {
            const type =
              String(
                account.account_type ||
                  ""
              ).toLowerCase();

            return (
              type === "savings" ||
              type === "saving"
            );
          }
        );

      const checkingBalance =
        Number(
          checkingAccount
            ?.account_balances?.[0]
            ?.available_balance ??
            0
        );

      const savingsBalance =
        Number(
          savingsAccount
            ?.account_balances?.[0]
            ?.available_balance ??
            0
        );

      let cards =
        [];

      try {
        const result =
          await supabase
            .from("cards")
            .select("*")
            .eq(
              "user_id",
              userId
            )
            .order(
              "created_at",
              {
                ascending:
                  false
              }
            );

        if (!result.error) {
          cards =
            result.data || [];
        }
      } catch (error) {
        console.error(
          "ME CARDS EXCEPTION:",
          error
        );
      }

      const card =
        cards[0] || null;

      const cardBalance =
        Number(
          card?.balance ?? 0
        );

      return res.json({
        success: true,

        user:
          req.user,

        profile,

        address,

        accounts:
          accountListWithBalances,

        cards,

        balances: {
          checking:
            checkingBalance,

          savings:
            savingsBalance,

          card:
            cardBalance
        }
      });
    } catch (error) {
      console.error(
        "AUTH ME ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load user",
        error:
          error.message
      });
    }
  }
);


/* =====================================================
   ACCOUNTS
===================================================== */

app.get(
  "/api/accounts",
  authenticate,
  async (req, res) => {
    try {
      const {
        data: accounts,
        error: accountsError
      } =
        await supabase
          .from("accounts")
          .select("*")
          .eq(
            "user_id",
            req.user.id
          );

      if (accountsError) {
        return res.status(500).json({
          success: false,
          message:
            accountsError.message
        });
      }

      const accountList =
        accounts || [];

      const accountIds =
        accountList
          .map(
            account =>
              account.id
          )
          .filter(Boolean);

      let balances =
        [];

      if (
        accountIds.length
      ) {
        const {
          data,
          error
        } =
          await supabase
            .from(
              "account_balances"
            )
            .select("*")
            .in(
              "account_id",
              accountIds
            );

        if (error) {
          return res.status(500).json({
            success: false,
            message:
              error.message
          });
        }

        balances =
          data || [];
      }

      const balanceMap =
        new Map();

      balances.forEach(
        balance => {
          balanceMap.set(
            balance.account_id,
            balance
          );
        }
      );

      const result =
        accountList.map(
          account => ({
            ...account,

            account_balances:
              balanceMap.has(
                account.id
              )
                ? [
                    balanceMap.get(
                      account.id
                    )
                  ]
                : []
          })
        );

      return res.json({
        success: true,
        accounts:
          result
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to load accounts"
      });
    }
  }
);

/* =====================================================
   ACCOUNT DETAILS
===================================================== */

app.get(
  "/api/accounts/:id",
  authenticate,
  async (req, res) => {
    try {
      const {
        data: account,
        error: accountError
      } =
        await supabase
          .from("accounts")
          .select("*")
          .eq(
            "id",
            req.params.id
          )
          .eq(
            "user_id",
            req.user.id
          )
          .maybeSingle();

      if (
        accountError ||
        !account
      ) {
        return res.status(404).json({
          success: false,
          message:
            "Account not found"
        });
      }

      const {
        data: balance,
        error: balanceError
      } =
        await supabase
          .from(
            "account_balances"
          )
          .select("*")
          .eq(
            "account_id",
            account.id
          )
          .maybeSingle();

      if (balanceError) {
        return res.status(500).json({
          success: false,
          message:
            balanceError.message
        });
      }

      return res.json({
        success: true,

        account: {
          ...account,

          account_balances:
            balance
              ? [balance]
              : []
        }
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to load account"
      });
    }
  }
);

/* =====================================================
   TRANSACTIONS
===================================================== */

app.get(
  "/api/transactions",
  authenticate,
  async (req, res) => {
    try {
      const {
        data,
        error
      } =
        await supabase
          .from("transactions")
          .select("*")
          .eq(
            "user_id",
            req.user.id
          )
          .order(
            "created_at",
            {
              ascending:
                false
            }
          );

      if (error) {
        return res.status(500).json({
          success: false,
          message:
            error.message
        });
      }

      return res.json({
        success: true,
        transactions:
          data || []
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to load transactions"
      });
    }
  }
);

/* =====================================================
   BENEFICIARIES
===================================================== */

app.get(
  "/api/beneficiaries",
  authenticate,
  async (req, res) => {
    try {
      const {
        data,
        error
      } =
        await supabase
          .from(
            "beneficiaries"
          )
          .select("*")
          .eq(
            "user_id",
            req.user.id
          )
          .order(
            "created_at",
            {
              ascending:
                false
            }
          );

      if (error) {
        return res.status(500).json({
          success: false,
          message:
            error.message
        });
      }

      return res.json({
        success: true,
        beneficiaries:
          data || []
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to load beneficiaries"
      });
    }
  }
);

app.post(
  "/api/beneficiaries",
  authenticate,
  async (req, res) => {
    try {
      const {
        name,
        bank_name,
        account_identifier,
        account_type
      } = req.body || {};

      if (
        !name ||
        !bank_name ||
        !account_identifier
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Required beneficiary information is missing"
        });
      }

      const {
        data,
        error
      } =
        await supabase
          .from(
            "beneficiaries"
          )
          .insert({
            user_id:
              req.user.id,

            name:
              String(
                name
              ).trim(),

            bank_name:
              String(
                bank_name
              ).trim(),

            account_identifier:
              String(
                account_identifier
              ).trim(),

            account_type:
              account_type ||
              "checking"
          })
          .select()
          .single();

      if (error) {
        return res.status(400).json({
          success: false,
          message:
            error.message
        });
      }

      return res.status(201).json({
        success: true,
        message:
          "Beneficiary added",
        beneficiary:
          data
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to create beneficiary"
      });
    }
  }
);

app.delete(
  "/api/beneficiaries/:id",
  authenticate,
  async (req, res) => {
    try {
      const {
        error
      } =
        await supabase
          .from(
            "beneficiaries"
          )
          .delete()
          .eq(
            "id",
            req.params.id
          )
          .eq(
            "user_id",
            req.user.id
          );

      if (error) {
        return res.status(400).json({
          success: false,
          message:
            error.message
        });
      }

      return res.json({
        success: true,
        message:
          "Beneficiary deleted"
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to delete beneficiary"
      });
    }
  }
);



/* =====================================================
   TRANSFERS
===================================================== */
app.post(
  "/api/transfers",
  authenticate,
  async (req, res) => {
    try {
      const {
        recipient_account_number,
        recipient_name,
        recipient_bank,
        amount,
        description
      } = req.body || {};
      /* =================================================
         VALIDATE REQUEST
      ================================================= */
      if (
        !recipient_account_number ||
        amount === undefined ||
        amount === null
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Recipient account and amount are required"
        });
      }
      const recipientAccountNumber =
        String(
          recipient_account_number
        ).trim();
      const transferAmount =
        Number(amount);
      if (
        !Number.isFinite(
          transferAmount
        ) ||
        transferAmount <= 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid transfer amount"
        });
      }
      /* =================================================
         APPROVED RECIPIENT ACCOUNTS
         
         These are validated on the SERVER.
      ================================================= */
      const recipients = {
        "8115737838": {
          name:
            "Raphael Ovadje",
          bank:
            "Bank of America"
        },
        "123456789": {
          name:
            "Olueay Shay",
          bank:
            "Bank of America"
        }
      };
      const recipient =
        recipients[
          recipientAccountNumber
        ];
      if (!recipient) {
        return res.status(400).json({
          success: false,
          message:
            "Recipient account is not supported"
        });
      }
      /* =================================================
         CHECK SENDER ACCOUNT
         
         Automatically use the logged-in user's
         active checking account.
      ================================================= */
      const {
        data: account,
        error: accountError
      } =
        await supabase
          .from("accounts")
          .select("*")
          .eq(
            "user_id",
            req.user.id
          )
         .eq(
  "account_type",
  "checking"
)
.in(
  "status",
  ["active", "suspended"]
)
.limit(1)
          .maybeSingle();
      if (accountError) {
        console.error(
          "SENDER ACCOUNT ERROR:",
          accountError
        );
        return res.status(500).json({
          success: false,
          message:
            accountError.message
        });
      }
      if (!account) {
        return res.status(404).json({
          success: false,
          message:
            "Active checking account not found"
        });
      }
      /* =================================================
         CHECK ACCOUNT BALANCE
      ================================================= */
      const {
        data: balance,
        error: balanceError
      } =
        await supabase
          .from(
            "account_balances"
          )
          .select("*")
          .eq(
            "account_id",
            account.id
          )
          .maybeSingle();
      if (balanceError) {
        console.error(
          "BALANCE LOOKUP ERROR:",
          balanceError
        );
        return res.status(500).json({
          success: false,
          message:
            balanceError.message
        });
      }
      if (!balance) {
        return res.status(404).json({
          success: false,
          message:
            "Account balance not found"
        });
      }
      const availableBalance =
        Number(
          balance.available_balance
        );
      if (
        !Number.isFinite(
          availableBalance
        )
      ) {
        return res.status(500).json({
          success: false,
          message:
            "Invalid account balance"
        });
      }
      if (
        availableBalance <
        transferAmount
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Insufficient funds"
        });
      }
      /* =================================================
         CREATE TRANSFER REFERENCE
      ================================================= */
      const reference =
        generateReference(
          "TRF"
        );
      /* =================================================
         CREATE PENDING TRANSFER
         
         beneficiary_id is intentionally null because
         your transfer page uses the approved recipient
         account numbers directly.
      ================================================= */
      const {
        data: transfer,
        error: transferError
      } =
        await supabase
          .from("transfers")
          .insert({
            sender_user_id:
              req.user.id,
            sender_account_id:
              account.id,
            beneficiary_id:
              null,
            amount:
              transferAmount,
            currency:
              account.currency,
            reference,
            status:
              "pending"
          })
          .select()
          .single();
      if (transferError) {
        console.error(
          "TRANSFER CREATE ERROR:",
          transferError
        );
        return res.status(400).json({
          success: false,
          message:
            transferError.message
        });
      }
      /* =================================================
         GENERATE 6-DIGIT VERIFICATION CODE
      ================================================= */
      const verificationCode =
        crypto
          .randomInt(
            100000,
            1000000
          )
          .toString();
      const codeHash =
        crypto
          .createHash(
            "sha256"
          )
          .update(
            verificationCode
          )
          .digest("hex");
      const expiresAt =
        new Date(
          Date.now() +
          CODE_EXPIRY
        ).toISOString();
      /* =================================================
         STORE VERIFICATION
      ================================================= */
      const {
        data: verification,
        error:
          verificationError
      } =
        await supabase
          .from(
            "transfer_verifications"
          )
          .insert({
            user_id:
              req.user.id,
            transfer_id:
              transfer.id,
            code_hash:
              codeHash,
            expires_at:
              expiresAt,
            attempts:
              0
          })
          .select()
          .single();
      if (verificationError) {
        console.error(
          "TRANSFER VERIFICATION CREATE ERROR:",
          verificationError
        );
        /* Remove pending transfer
           if verification could
           not be created. */
        await supabase
          .from("transfers")
          .delete()
          .eq(
            "id",
            transfer.id
          )
          .eq(
            "sender_user_id",
            req.user.id
          );
        return res.status(500).json({
          success: false,
          message:
            "Unable to create transfer verification"
        });
      }
      /* =================================================
         SEND OTP EMAIL
         
         Currently disabled because:
         SEND_TRANSFER_OTP_EMAIL = false
      ================================================= */
            if (
        SEND_TRANSFER_OTP_EMAIL
      ) {
        try {
          const customerEmail =
            req.user.email;
          if (!customerEmail) {
            throw new Error(
              "Customer email not found"
            );
          }
          const {
            data: emailData,
            error: emailError
          } =
            await resend.emails.send({
              from:
                "Sterling One Bank <onboarding@resend.dev>",
              to:
                customerEmail,
              subject:
                "Sterling One Bank Transfer Verification",
              html: `
                <div style="
                  font-family:Arial,sans-serif;
                  line-height:1.6;
                ">
                  <h2>
                    Sterling One Bank
                  </h2>
                  <p>
                    Your transfer verification
                    code is:
                  </p>
                  <div style="
                    font-size:32px;
                    font-weight:bold;
                    letter-spacing:8px;
                    margin:20px 0;
                  ">
                    ${verificationCode}
                  </div>
                  <p>
                    This code expires in
                    10 minutes.
                  </p>
                  <p>
                    If you did not request
                    this transfer, please
                    contact Sterling One Bank
                    Support immediately.
                  </p>
                </div>
              `
            });
          console.log(
            "RESEND EMAIL RESPONSE:",
            {
              data: emailData,
              error: emailError
            }
          );
          if (emailError) {
            throw new Error(
              emailError.message ||
              "Resend failed to send email"
            );
          }
        } catch (emailError) {
          console.error(
            "TRANSFER OTP EMAIL ERROR:",
            emailError
          );
        }
      }
      /* =================================================
         RESPONSE
      ================================================= */
      return res.status(201).json({
        success: true,
        message:
          "Transfer verification required",
        transfer: {
          id:
            transfer.id,
          reference:
            transfer.reference,
          amount:
            transfer.amount,
          currency:
            transfer.currency,
          status:
            transfer.status,
          recipient: {
            account_number:
              recipientAccountNumber,
            name:
              recipient.name,
            bank:
              recipient.bank
          }
        },
        verification: {
          required:
            true,
          expires_at:
            expiresAt
        }
      });
    } catch (error) {
      console.error(
        "TRANSFER CREATE EXCEPTION:",
        error
      );
      return res.status(500).json({
        success: false,
        message:
          "Unable to create transfer"
      });
    }
  }
);

/* =====================================================
   VERIFY TRANSFER
===================================================== */
app.post(
  "/api/transfers/verify",
  authenticate,
  async (req, res) => {
    try {
      const {
        transfer_id,
        code
      } = req.body || {};
      /* =================================================
         VALIDATE INPUT
      ================================================= */
      if (!transfer_id || !code) {
        return res.status(400).json({
          success: false,
          message:
            "Transfer ID and verification code are required"
        });
      }
      const verificationCode =
        String(code).trim();
      if (!/^\d{6}$/.test(verificationCode)) {
        return res.status(400).json({
          success: false,
          message:
            "Verification code must be 6 digits"
        });
      }
      /* =================================================
         FIND TRANSFER
      ================================================= */
      const {
        data: transfer,
        error: transferError
      } =
        await supabase
          .from("transfers")
          .select("*")
          .eq(
            "id",
            transfer_id
          )
          .eq(
            "sender_user_id",
            req.user.id
          )
          .maybeSingle();
      if (transferError) {
        console.error(
          "TRANSFER LOOKUP ERROR:",
          transferError
        );
        return res.status(500).json({
          success: false,
          message:
            transferError.message
        });
      }
      if (!transfer) {
        return res.status(404).json({
          success: false,
          message:
            "Transfer not found"
        });
      }
      /* =================================================
         CHECK TRANSFER STATUS
      ================================================= */
      if (
        transfer.status !==
        "pending"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "This transfer is no longer awaiting verification"
        });
      }
      /* =================================================
         FIND LATEST VERIFICATION
      ================================================= */
      const {
        data: verification,
        error: verificationError
      } =
        await supabase
          .from(
            "transfer_verifications"
          )
          .select("*")
          .eq(
            "transfer_id",
            transfer_id
          )
          .eq(
            "user_id",
            req.user.id
          )
          .order(
            "created_at",
            {
              ascending: false
            }
          )
          .limit(1)
          .maybeSingle();
      if (verificationError) {
        console.error(
          "TRANSFER VERIFICATION LOOKUP ERROR:",
          verificationError
        );
        return res.status(500).json({
          success: false,
          message:
            verificationError.message
        });
      }
      if (!verification) {
        return res.status(404).json({
          success: false,
          message:
            "Transfer verification not found"
        });
      }
      /* =================================================
         ALREADY VERIFIED
      ================================================= */
      if (
        verification.verified_at
      ) {
        return res.status(400).json({
          success: false,
          message:
            "This verification code has already been used"
        });
      }
      /* =================================================
         CHECK ATTEMPTS
      ================================================= */
      const MAX_ATTEMPTS = 5;
      if (
        Number(
          verification.attempts
        ) >= MAX_ATTEMPTS
      ) {
        return res.status(429).json({
          success: false,
          message:
            "Too many incorrect attempts. Please request a new verification code."
        });
      }
      /* =================================================
         CHECK EXPIRATION
      ================================================= */
      const expiresAt =
        new Date(
          verification.expires_at
        ).getTime();
      if (
        !Number.isFinite(
          expiresAt
        ) ||
        Date.now() >
          expiresAt
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Verification code has expired"
        });
      }
      /* =================================================
         HASH SUBMITTED CODE
      ================================================= */
      const submittedHash =
        crypto
          .createHash("sha256")
          .update(
            verificationCode
          )
          .digest("hex");
      /* =================================================
         COMPARE HASHES
      ================================================= */
      const submittedBuffer =
        Buffer.from(
          submittedHash,
          "utf8"
        );
      const storedBuffer =
        Buffer.from(
          verification.code_hash,
          "utf8"
        );
      const codeMatches =
  submittedBuffer.length ===
    storedBuffer.length &&
  crypto.timingSafeEqual(
    submittedBuffer,
    storedBuffer
);
      /* =================================================
         INCORRECT CODE
      ================================================= */
      if (!codeMatches) {
        const newAttempts =
          Number(
            verification.attempts
          ) + 1;
        await supabase
          .from(
            "transfer_verifications"
          )
          .update({
            attempts:
              newAttempts
          })
          .eq(
            "id",
            verification.id
          )
          .eq(
            "user_id",
            req.user.id
          );
        const remainingAttempts =
          Math.max(
            0,
            MAX_ATTEMPTS -
              newAttempts
          );
        if (
          remainingAttempts === 0
        ) {
          return res.status(429).json({
            success: false,
            message:
              "Too many incorrect attempts. Please request a new verification code."
          });
        }
        return res.status(400).json({
          success: false,
          message:
            "Incorrect verification code",
          remaining_attempts:
            remainingAttempts
        });
      }
      
      /* =================================================
   CHECK ACCOUNT SUSPENSION
================================================= */
const {
  data: senderAccount,
  error: senderAccountError
} = await supabase
  .from("accounts")
  .select("id, status")
  .eq("user_id", req.user.id)
  .eq("account_type", "checking")
  .in("status", ["active", "suspended"])
  .limit(1)
  .maybeSingle();

if (senderAccountError) {
  console.error(
    "SENDER ACCOUNT STATUS ERROR:",
    senderAccountError
  );

  return res.status(500).json({
    success: false,
    message:
      "Unable to verify account status"
  });
}

if (!senderAccount) {
  return res.status(404).json({
    success: false,
    message:
      "Checking account not found"
  });
}

if (
  senderAccount.status ===
  "suspended"
) {
  return res.status(403).json({
    success: false,
    code:
      "ACCOUNT_SUSPENDED",
    message:
      "Transfer failed. Please contact Support."
  });
}
      
      
      /* =================================================
         MARK CODE AS VERIFIED
      ================================================= */
      const verifiedAt =
        new Date().toISOString();
      const {
        error:
          verificationUpdateError
      } =
        await supabase
          .from(
            "transfer_verifications"
          )
          .update({
            verified_at:
              verifiedAt
          })
          .eq(
            "id",
            verification.id
          )
          .eq(
            "user_id",
            req.user.id
          );
      if (
        verificationUpdateError
      ) {
        console.error(
          "TRANSFER VERIFICATION UPDATE ERROR:",
          verificationUpdateError
        );
        return res.status(500).json({
          success: false,
          message:
            "Unable to complete transfer verification"
        });
      }
      /* =================================================
         MARK TRANSFER AS VERIFIED
      ================================================= */
      const {
        data:
          updatedTransfer,
        error:
          transferUpdateError
      } =
        await supabase
          .from("transfers")
          .update({
            status:
              "verified"
          })
          .eq(
            "id",
            transfer_id
          )
          .eq(
            "sender_user_id",
            req.user.id
          )
          .select()
          .single();
      if (
        transferUpdateError
      ) {
        console.error(
          "TRANSFER STATUS UPDATE ERROR:",
          transferUpdateError
        );
        return res.status(500).json({
          success: false,
          message:
            "Verification succeeded but transfer status could not be updated"
        });
      }
      /* =================================================
         SUCCESS
      ================================================= */
      return res.status(200).json({
        success: true,
        message:
          "Transfer verification successful",
        transfer: {
          id:
            updatedTransfer.id,
          reference:
            updatedTransfer.reference,
          amount:
            updatedTransfer.amount,
          currency:
            updatedTransfer.currency,
          status:
            updatedTransfer.status
        }
      });
    } catch (error) {
      console.error(
        "TRANSFER VERIFICATION ERROR:",
        error
      );
      return res.status(500).json({
        success: false,
        message:
          "Unable to verify transfer"
      });
    }
  }
);



/* =====================================================
   CARDS
===================================================== */

app.get(
  "/api/cards",
  authenticate,
  async (req, res) => {
    try {
      const {
        data,
        error
      } =
        await supabase
          .from("cards")
          .select("*")
          .eq(
            "user_id",
            req.user.id
          )
          .order(
            "created_at",
            {
              ascending:
                false
            }
          );

      if (error) {
        return res.status(500).json({
          success: false,
          message:
            error.message
        });
      }

      return res.json({
        success: true,
        cards:
          data || []
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to load cards"
      });
    }
  }
);

/* =====================================================
   NOTIFICATIONS
===================================================== */

app.get(
  "/api/notifications",
  authenticate,
  async (req, res) => {
    try {
      const {
        data,
        error
      } =
        await supabase
          .from(
            "notifications"
          )
          .select("*")
          .eq(
            "user_id",
            req.user.id
          )
          .order(
            "created_at",
            {
              ascending:
                false
            }
          );

      if (error) {
        return res.status(500).json({
          success: false,
          message:
            error.message
        });
      }

      return res.json({
        success: true,
        notifications:
          data || []
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to load notifications"
      });
    }
  }
);

app.patch(
  "/api/notifications/:id/read",
  authenticate,
  async (req, res) => {
    try {
      const {
        data,
        error
      } =
        await supabase
          .from(
            "notifications"
          )
          .update({
            read_at:
              new Date().toISOString()
          })
          .eq(
            "id",
            req.params.id
          )
          .eq(
            "user_id",
            req.user.id
          )
          .select()
          .maybeSingle();

      if (error || !data) {
        return res.status(404).json({
          success: false,
          message:
            "Notification not found"
        });
      }

      return res.json({
        success: true,
        notification:
          data
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          "Unable to update notification"
      });
    }
  }
);

/* =====================================================
   ADMIN STATS
===================================================== */

app.get(
  "/api/admin/stats",
  authenticateAdmin,
  async (req, res) => {
    try {
      const {
        count: users,
        error: usersError
      } =
        await supabase
          .from("profiles")
          .select("*", {
            count:
              "exact",

            head:
              true
          })
          .eq(
            "is_admin",
            false
          );

      if (usersError) {
        throw usersError;
      }

      const {
        count: accounts,
        error:
          accountsError
      } =
        await supabase
          .from("accounts")
          .select("*", {
            count:
              "exact",

            head:
              true
          });

      if (accountsError) {
        throw accountsError;
      }

      const {
        count:
          pendingWithdrawals,
        error:
          withdrawalsError
      } =
        await supabase
          .from(
            "withdrawals"
          )
          .select("*", {
            count:
              "exact",

            head:
              true
          })
          .eq(
            "status",
            "pending"
          );

      if (withdrawalsError) {
        throw withdrawalsError;
      }

      const {
        count:
          pendingTransfers,
        error:
          transfersError
      } =
        await supabase
          .from(
            "transfers"
          )
          .select("*", {
            count:
              "exact",

            head:
              true
          })
          .in(
            "status",
            [
              "pending",
              "processing"
            ]
          );

      if (transfersError) {
        throw transfersError;
      }

      return res.json({
        success: true,

        stats: {
          users:
            users || 0,

          accounts:
            accounts || 0,

          pending_withdrawals:
            pendingWithdrawals ||
            0,

          pending_transfers:
            pendingTransfers ||
            0
        }
      });
    } catch (error) {
      console.error(
        "ADMIN STATS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load admin statistics",
        error:
          error.message
      });
    }
  }
);

/* =====================================================
   ADMIN SINGLE USER
===================================================== */

app.get(
  "/api/admin/users/:id",
  authenticateAdmin,
  async (req, res) => {
    try {
      const userId =
        req.params.id;

      const {
        data: profile,
        error:
          profileError
      } =
        await supabase
          .from("profiles")
          .select("*")
          .eq(
            "id",
            userId
          )
          .maybeSingle();

      if (profileError) {
        return res.status(500).json({
          success: false,
          message:
            profileError.message
        });
      }

      if (!profile) {
        return res.status(404).json({
          success: false,
          message:
            "User not found"
        });
      }

      let authUser =
        null;

      try {
        const {
          data,
          error
        } =
          await supabase.auth.admin
            .getUserById(
              userId
            );

        if (!error) {
          authUser =
            data?.user ||
            null;
        }
      } catch (error) {
        console.error(
          "AUTH USER LOOKUP ERROR:",
          error
        );
      }

      let address =
        null;

      try {
        const {
          data,
          error
        } =
          await supabase
            .from(
              "customer_addresses"
            )
            .select("*")
            .eq(
              "user_id",
              userId
            )
            .limit(1);

        if (!error) {
          address =
            data?.[0] ||
            null;
        }
      } catch (error) {
        console.error(
          "ADMIN ADDRESS ERROR:",
          error
        );
      }

      const {
        data: accounts,
        error:
          accountsError
      } =
        await supabase
          .from("accounts")
          .select("*")
          .eq(
            "user_id",
            userId
          );

      if (accountsError) {
        return res.status(500).json({
          success: false,
          message:
            accountsError.message
        });
      }

      const accountList =
        accounts || [];

      const accountIds =
        accountList
          .map(
            account =>
              account.id
          )
          .filter(Boolean);

      let balances =
        [];

      if (
        accountIds.length
      ) {
        const {
          data,
          error
        } =
          await supabase
            .from(
              "account_balances"
            )
            .select("*")
            .in(
              "account_id",
              accountIds
            );

        if (error) {
          return res.status(500).json({
            success: false,
            message:
              error.message
          });
        }

        balances =
          data || [];
      }

      const balanceMap =
        new Map();

      balances.forEach(
        balance => {
          balanceMap.set(
            balance.account_id,
            balance
          );
        }
      );

      const accountsWithBalances =
        accountList.map(
          account => ({
            ...account,

            account_balances:
              balanceMap.has(
                account.id
              )
                ? [
                    balanceMap.get(
                      account.id
                    )
                  ]
                : []
          })
        );

      let cards =
        [];

      try {
        const result =
          await supabase
            .from("cards")
            .select("*")
            .eq(
              "user_id",
              userId
            );

        if (!result.error) {
          cards =
            result.data || [];
        }
      } catch (error) {
        console.error(
          "ADMIN CARDS EXCEPTION:",
          error
        );
      }

      const checkingAccount =
        accountsWithBalances.find(
          account =>
            String(
              account.account_type ||
                ""
            ).toLowerCase() ===
            "checking"
        );

      const savingsAccount =
        accountsWithBalances.find(
          account => {
            const type =
              String(
                account.account_type ||
                  ""
              ).toLowerCase();

            return (
              type === "savings" ||
              type === "saving"
            );
          }
        );

      const checkingBalance =
        Number(
          checkingAccount
            ?.account_balances?.[0]
            ?.available_balance ??
            0
        );

      const savingsBalance =
        Number(
          savingsAccount
            ?.account_balances?.[0]
            ?.available_balance ??
            0
        );

      const cardBalance =
        Number(
          cards[0]?.balance ??
            0
        );

      const fullName =
        [
          profile.first_name,
          profile.surname
        ]
          .filter(Boolean)
          .join(" ")
          .trim();

      return res.json({
        success: true,

        profile: {
          ...profile,

          full_name:
            fullName ||
            "Unnamed User",

          email:
            authUser?.email ||
            profile.email ||
            "No email"
        },

        address,

        accounts:
          accountsWithBalances,

        cards,

        balances: {
          checking:
            checkingBalance,

          savings:
            savingsBalance,

          card:
            cardBalance
        }
      });
    } catch (error) {
      console.error(
        "ADMIN USER DETAILS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load user",
        error:
          error.message
      });
    }
  }
);

/* =====================================================
   ADMIN BALANCE UPDATE
===================================================== */

app.put(
  "/api/admin/users/:id/balances",
  authenticateAdmin,
  async (req, res) => {
    try {
      const userId =
        req.params.id;

      const {
        checking_balance,
        savings_balance,
        card_balance
      } = req.body || {};

      const checking =
        Number(
          checking_balance
        );

      const savings =
        Number(
          savings_balance
        );

      const card =
        Number(
          card_balance
        );

      if (
        !Number.isFinite(
          checking
        ) ||
        !Number.isFinite(
          savings
        ) ||
        !Number.isFinite(
          card
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid balance amount"
        });
      }

      if (
        checking < 0 ||
        savings < 0 ||
        card < 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Balance cannot be negative"
        });
      }

      const {
        data: profile,
        error:
          profileError
      } =
        await supabase
          .from("profiles")
          .select(
            "id, is_admin"
          )
          .eq(
            "id",
            userId
          )
          .maybeSingle();

      if (profileError) {
        return res.status(500).json({
          success: false,
          message:
            profileError.message
        });
      }

      if (!profile) {
        return res.status(404).json({
          success: false,
          message:
            "User not found"
        });
      }

      if (
        isAdminValue(
          profile.is_admin
        )
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Administrator balances cannot be modified here"
        });
      }

      const {
        data: accounts,
        error:
          accountsError
      } =
        await supabase
          .from("accounts")
          .select("*")
          .eq(
            "user_id",
            userId
          );

      if (accountsError) {
        return res.status(500).json({
          success: false,
          message:
            accountsError.message
        });
      }

      const checkingAccount =
        (accounts || []).find(
          account =>
            String(
              account.account_type ||
                ""
            ).toLowerCase() ===
            "checking"
        );

      let savingsAccount =
        (accounts || []).find(
          account => {
            const type =
              String(
                account.account_type ||
                  ""
              ).toLowerCase();

            return (
              type === "savings" ||
              type === "saving"
            );
          }
        );

      if (!checkingAccount) {
        return res.status(400).json({
          success: false,
          message:
            "Checking account not found"
        });
      }

      /* ---------------------------------------------
         CHECKING
      --------------------------------------------- */

      const {
        data:
          existingCheckingBalance,
        error:
          checkingLookupError
      } =
        await supabase
          .from(
            "account_balances"
          )
          .select("*")
          .eq(
            "account_id",
            checkingAccount.id
          )
          .maybeSingle();

      if (checkingLookupError) {
        return res.status(500).json({
          success: false,
          message:
            checkingLookupError.message
        });
      }

      if (
        existingCheckingBalance
      ) {
        const {
          error:
            checkingError
        } =
          await supabase
            .from(
              "account_balances"
            )
            .update({
              available_balance:
                checking,

              ledger_balance:
                checking,

              updated_at:
                new Date().toISOString()
            })
            .eq(
              "account_id",
              checkingAccount.id
            );

        if (checkingError) {
          return res.status(500).json({
            success: false,
            message:
              checkingError.message
          });
        }
      } else {
        const {
          error:
            checkingCreateError
        } =
          await supabase
            .from(
              "account_balances"
            )
            .insert({
              account_id:
                checkingAccount.id,

              available_balance:
                checking,

              ledger_balance:
                checking
            });

        if (checkingCreateError) {
          return res.status(500).json({
            success: false,
            message:
              checkingCreateError.message
          });
        }
      }

      /* ---------------------------------------------
         SAVINGS
      --------------------------------------------- */

      if (savingsAccount) {
        const {
          data:
            existingSavingsBalance,
          error:
            savingsLookupError
        } =
          await supabase
            .from(
              "account_balances"
            )
            .select("*")
            .eq(
              "account_id",
              savingsAccount.id
            )
            .maybeSingle();

        if (savingsLookupError) {
          return res.status(500).json({
            success: false,
            message:
              savingsLookupError.message
          });
        }

        if (
          existingSavingsBalance
        ) {
          const {
            error:
              savingsError
          } =
            await supabase
              .from(
                "account_balances"
              )
              .update({
                available_balance:
                  savings,

                ledger_balance:
                  savings,

                updated_at:
                  new Date().toISOString()
              })
              .eq(
                "account_id",
                savingsAccount.id
              );

          if (savingsError) {
            return res.status(500).json({
              success: false,
              message:
                savingsError.message
            });
          }
        } else {
          const {
            error:
              savingsCreateError
          } =
            await supabase
              .from(
                "account_balances"
              )
              .insert({
                account_id:
                  savingsAccount.id,

                available_balance:
                  savings,

                ledger_balance:
                  savings
              });

          if (savingsCreateError) {
            return res.status(500).json({
              success: false,
              message:
                savingsCreateError.message
            });
          }
        }
      } else {
        const accountNumber =
          await generateAccountNumber();

        const {
          data: newSavings,
          error:
            savingsAccountError
        } =
          await supabase
            .from("accounts")
            .insert({
              user_id:
                userId,

              account_number:
                accountNumber,

              account_type:
                "savings",

              currency:
                "USD",

              status:
                "active"
            })
            .select()
            .single();

        if (
          savingsAccountError ||
          !newSavings
        ) {
          return res.status(500).json({
            success: false,
            message:
              savingsAccountError?.message ||
              "Unable to create savings account"
          });
        }

        savingsAccount =
          newSavings;

        const {
          error:
            savingsBalanceError
        } =
          await supabase
            .from(
              "account_balances"
            )
            .insert({
              account_id:
                newSavings.id,

              available_balance:
                savings,

              ledger_balance:
                savings
            });

        if (savingsBalanceError) {
          return res.status(500).json({
            success: false,
            message:
              savingsBalanceError.message
          });
        }
      }

      /* ---------------------------------------------
         CARD BALANCE
      --------------------------------------------- */

      const {
        data: existingCard,
        error:
          cardLookupError
      } =
        await supabase
          .from("cards")
          .select("*")
          .eq(
            "user_id",
            userId
          )
          .order(
            "created_at",
            {
              ascending:
                false
            }
          )
          .limit(1)
          .maybeSingle();

      if (cardLookupError) {
        console.error(
          "CARD LOOKUP ERROR:",
          cardLookupError
        );

        return res.status(500).json({
          success: false,
          message:
            cardLookupError.message
        });
      }

      if (existingCard) {
        const {
          error:
            cardUpdateError
        } =
          await supabase
            .from("cards")
            .update({
              balance:
                card,

              updated_at:
                new Date().toISOString()
            })
            .eq(
              "id",
              existingCard.id
            );

        if (cardUpdateError) {
          console.error(
            "CARD UPDATE ERROR:",
            cardUpdateError
          );

          return res.status(500).json({
            success: false,
            message:
              cardUpdateError.message
          });
        }
      } else {
        const {
          error:
            cardCreateError
        } =
          await supabase
            .from("cards")
            .insert({
              user_id:
                userId,

              account_id:
                checkingAccount.id,

              balance:
                card,

              card_type:
                "debit",

              brand:
                "Visa",

              last_four:
                "0000",

              status:
                "active"
            });

        if (cardCreateError) {
          console.error(
            "CARD CREATE ERROR:",
            cardCreateError
          );

          return res.status(500).json({
            success: false,
            message:
              cardCreateError.message
          });
        }
      }

      return res.json({
        success: true,

        message:
          "User balances updated successfully",

        balances: {
          checking,

          savings,

          card
        }
      });
    } catch (error) {
      console.error(
        "ADMIN BALANCE UPDATE ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to update user balances",
        error:
          error.message
      });
    }
  }
);




/* =====================================================
   404 HANDLER
===================================================== */

app.use(
  (req, res) => {
    res.status(404).json({
      success: false,

      message:
        `Route not found: ${req.method} ${req.originalUrl}`
    });
  }
);

/* =====================================================
   GLOBAL ERROR HANDLER
===================================================== */

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      "UNHANDLED SERVER ERROR:",
      error
    );

    if (
      res.headersSent
    ) {
      return next(error);
    }

    res.status(500).json({
      success: false,

      message:
        "Internal server error",

      error:
        error.message
    });
  }
);

/* =====================================================
   START SERVER
===================================================== */

app.listen(
  PORT,
  () => {
    console.log(
      `Capital Crest Bank API running on port ${PORT}`
    );
  }
);