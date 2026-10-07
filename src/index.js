const http = require("http");
const { Client, GatewayIntentBits } = require("discord.js");
const config = require("./config");
const agent = require("./agent");
const controller = require("./controller");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Discord Gateway diagnostics. Keep these enabled so authentication,
// privileged-intent failures, disconnects, and reconnect loops are visible
// in Render instead of looking like a silent login hang.
client.on("error", error => {
  console.error("[Discord] client error:", error?.stack || error);
});

client.on("warn", message => {
  console.warn("[Discord] warning:", message);
});

client.on("debug", message => {
  const safe = String(message)
    .replace(config.discordToken, "[REDACTED]")
    .replace(/(Provided token:\s*)\S+/i, "$1[REDACTED]");
  console.log("[Discord] debug:", safe);
});

client.on("shardError", (error, shardId) => {
  console.error(`[Discord] shard ${shardId} WebSocket error:`, error?.stack || error);
});

client.on("shardDisconnect", (closeEvent, shardId) => {
  console.error(
    `[Discord] shard ${shardId} disconnected:`,
    JSON.stringify({
      code: closeEvent?.code ?? null,
      reason: closeEvent?.reason?.toString?.() ?? null,
      wasClean: closeEvent?.wasClean ?? null
    })
  );
});

client.on("shardReconnecting", shardId => {
  console.warn(`[Discord] shard ${shardId} reconnecting...`);
});

client.on("shardReady", (shardId, unavailableGuilds) => {
  console.log(
    `[Discord] shard ${shardId} ready; unavailable guilds:`,
    unavailableGuilds?.size ?? 0
  );
});

process.on("unhandledRejection", reason => {
  console.error("[Process] unhandled rejection:", reason?.stack || reason);
});

process.on("uncaughtException", error => {
  console.error("[Process] uncaught exception:", error?.stack || error);
});

const allowed = id =>
  !adminState.allowedChannelIds.length || adminState.allowedChannelIds.includes(id);

let locked = false;
const audit = [];
const record = (message, action, result = "ok") => { audit.unshift({ at: new Date().toISOString(), user: message.author.tag, action, result }); if (audit.length > 100) audit.pop(); };

const canAdmin = member =>
  config.adminIds.includes(member.id) ||
  member.roles.cache.some(role => adminState.adminRoleIds.includes(role.id));

const canControl = member =>
  canAdmin(member) ||
  (!config.adminIds.length && !adminState.controlRoleIds.length) ||
  member.roles.cache.some(role => adminState.controlRoleIds.includes(role.id));

const adminState = {
  allowedChannelIds: [...config.allowedChannelIds],
  controlRoleIds: [...config.controlRoleIds],
  adminRoleIds: [...config.adminRoleIds]
};

const adminHelp = () => [
  "**Smarties • Admin Controls**",
    "",
  "⚙️ `smc admin` — view configuration",
  "📍 `smc admin channel add/remove/list` — channel access",
  "🎮 `smc admin role add/remove/list` — control roles",
  "👑 `smc admin adminrole set/clear/list` — admin role",
  "🔒 `smc admin lock/unlock` — lock or unlock controls",
  "🧾 `smc admin audit` — recent actions"
].join("\n");

async function handleAdmin(message, parts) {
  if (!canAdmin(message.member))
    return message.reply("🔒 **SMC admin access required**\nYou need the configured admin role or admin user ID.");

  const target = (parts[2] || "status").toLowerCase();
  const action = (parts[3] || "list").toLowerCase();
  const ref = target === "channel" ? message.mentions.channels.first() : message.mentions.roles.first();

  if (target === "help" || target === "status") {
    return message.reply(adminHelp() + "\n\n**Current configuration**\n" +
      "Channels: " + (adminState.allowedChannelIds.length ? adminState.allowedChannelIds.map(id => `<#${id}>`).join(", ") : "All channels") + "\n" +
      "Control roles: " + (adminState.controlRoleIds.length ? adminState.controlRoleIds.map(id => `<@&${id}>`).join(", ") : "Anyone, because none are configured") + "\n" +
      "Admin roles: " + (adminState.adminRoleIds.length ? adminState.adminRoleIds.map(id => `<@&${id}>`).join(", ") : "None configured"));
  }

  if (target === "lock") { locked = true; return message.reply("🔒 **SMC controls locked.**"); }
  if (target === "unlock") { locked = false; return message.reply("🔓 **SMC controls unlocked.**"); }
  if (target === "audit") { return message.reply("🧾 **Recent SMC audit**\n" + (audit.length ? audit.slice(0, 20).map(x => `• ${x.at} — ${x.user} — ${x.action} — ${x.result}`).join("\n") : "No actions recorded.")); }

  if (target === "channel") {
    if (action === "list") return message.reply("📍 **Allowed channels**\n" + (adminState.allowedChannelIds.length ? adminState.allowedChannelIds.map(id => `<#${id}>`).join("\n") : "All channels"));
    if (!ref) return message.reply("⚠️ **Channel required**\nMention the Discord channel you want to use.");
    if (action === "add") {
      if (!adminState.allowedChannelIds.includes(ref.id)) adminState.allowedChannelIds.push(ref.id);
      return message.reply(`✅ **Channel added**\n${ref} can now receive SMC commands.`);
    }
    if (action === "remove") {
      adminState.allowedChannelIds.splice(0, adminState.allowedChannelIds.length, ...adminState.allowedChannelIds.filter(id => id !== ref.id));
      return message.reply(`✅ **Channel removed**\n${ref} can no longer receive SMC commands.`);
    }
  }

  if (target === "role") {
    if (action === "list") return message.reply("🎮 **Control roles**\n" + (adminState.controlRoleIds.length ? adminState.controlRoleIds.map(id => `<@&${id}>`).join("\n") : "None — control is open to everyone."));
    if (!ref) return message.reply("⚠️ **Role required**\nMention a role.");
    if (action === "add") {
      if (!adminState.controlRoleIds.includes(ref.id)) adminState.controlRoleIds.push(ref.id);
      return message.reply(`✅ **Control role added**\n${ref} can now control SMC.`);
    }
    if (action === "remove") {
      adminState.controlRoleIds.splice(0, adminState.controlRoleIds.length, ...adminState.controlRoleIds.filter(id => id !== ref.id));
      return message.reply(`✅ **Control role removed**\n${ref} can no longer control SMC.`);
    }
  }

  if (target === "adminrole") {
    if (action === "list") return message.reply("👑 **Admin roles**\n" + (adminState.adminRoleIds.length ? adminState.adminRoleIds.map(id => `<@&${id}>`).join("\n") : "None configured — use ADMIN_USER_IDS for initial access."));
    if (action === "clear") {
      adminState.adminRoleIds.length = 0;
      return message.reply("✅ **Admin role cleared.**\nInitial access remains available through `ADMIN_USER_IDS`.");
    }
    if (action === "set") {
      if (!ref) return message.reply("⚠️ **Role required**\nMention a role.");
      adminState.adminRoleIds.splice(0, adminState.adminRoleIds.length, ref.id);
      return message.reply(`👑 **Admin role updated**\n${ref} is now the SMC admin role.`);
    }
  }

  return message.reply(adminHelp());
}

const uptime = seconds => seconds == null ? "—" : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;

const statusIcon = value => ({
  online: "🟢",
  running: "🟢",
  offline: "⚫",
  stopped: "⚫",
  stopping: "🟡",
  starting: "🟡",
  restarting: "🟡",
  unknown: "⚪"
}[String(value).toLowerCase()] || "⚪");

const format = s => {
  const playerCount = `${s.players?.online ?? "—"} / ${s.players?.max ?? s.maxPlayers ?? "—"}`;
  return [
    "**Smarties • Server Status**",
    "",
    `${statusIcon(s.minecraft)} **Minecraft** — ${s.minecraft}`,
    `${statusIcon(s.codespace)} **Codespace** — ${s.codespace}`,
    `${statusIcon(s.agent)} **Agent** — ${s.agent}`,
    `${statusIcon(s.playit)} **Playit** — ${s.playit}`,
    "",
    `👥 **Players** — ${playerCount}`,
    `⏱️ **Uptime** — ${uptime(s.uptimeSec)}`,
    s.publicAddress ? "🌐 **Address**\n`" + s.publicAddress + "`" : "🌐 **Address** — not available",
    s.error ? `⚠️ **Error** — ${s.error}` : ""
  ].filter(Boolean).join("\n");
};

async function progress(message, text) {
  await message.edit(`🟡 **SMC**\n${text}`).catch(() => {});
}

async function handle(message, parts) {
  const command = (parts[1] || "help").toLowerCase();
  if (command === "admin") return handleAdmin(message, parts);
  if (!allowed(message.channelId)) return;
  if (command === "status") return message.reply(format(await controller.liveStatus()));
  if (command === "health") return message.reply(controller.formatHealth(await controller.liveStatus()));
  if (command === "logs") return message.reply(controller.formatLogs(await controller.liveStatus()));
  if (command === "crash") return message.reply(controller.formatCrash(await controller.liveStatus()));
  if (command === "properties" || command === "props") return message.reply(controller.formatProperties(await controller.liveStatus()));
  if (command === "address") return message.reply(controller.formatAddress(await controller.liveStatus()));
  if (command === "online") return message.reply(controller.formatOnline(await controller.liveStatus()));
  if (command === "whitelist" && !["add", "remove", "rm", "clear"].includes((parts[2] || "").toLowerCase())) return message.reply(controller.formatWhitelist(await controller.liveStatus()));
  if (command === "help") return message.reply([
    "**Smarties • Commands**",
    "",
    "🟢 **Server**",
    "`smc start` — start Minecraft",
    "`smc stop` — stop when empty",
    "`smc restart` — restart safely",
    "",
    "📊 **Information**",
    "`smc status` — server status",
    "`smc online` — players online",
    "`smc health` — health check",
    "`smc address` — Playit address",
    "`smc logs` — recent log",
    "`smc crash` — crash details",
    "",
    "👥 **Players**",
  "`smc say <message>`",
  "`smc kick <player>`",
  "`smc ban <player>` / `smc pardon <player>`",
  "`smc op <player>` / `smc deop <player>`",
    "`smc whitelist`",
    "`smc save`",
    "",
    "⚙️ **Minecraft commands**",
    "`smc command <minecraft command>` — run any Minecraft command (admin)",
    "",
    "⚙️ `smc admin` — admin controls"
  ].join("\n"));
  if (!canControl(message.member)) return message.reply("🔒 **Control access required.**");
  if (locked) return message.reply("🔒 **SMC controls are locked.**");
  const name = parts[2];
  let working = null;
  try {
    let result;
    const showState = async (title, text) => {
      const body = `🟡 **${title}**

${text}`;
      if (working) await working.edit(body).catch(() => {});
    };

    if (command === "start") {
      working = await message.reply("🟡 **Starting Minecraft**\nGetting the world online…");
      result = await controller.startServer((text) => showState("Starting", text));
    }
    else if (command === "stop") {
      working = await message.reply("🟡 **Stopping Minecraft**\nWaiting for a safe shutdown…");
      result = await controller.stopServer((text) => showState("Stopping", text));
    }
    else if (command === "restart") {
      working = await message.reply("🟡 **Restarting Minecraft**\nBringing the world back up safely…");
      result = await controller.restartServer((text) => showState("Restarting", text));
    }
    else if (command === "say") { const msg = parts.slice(2).join(" "); if (!msg) throw new Error("Usage: smc say <message>"); working = await message.reply("🟡 **Sending to Minecraft**\nPassing your message through…"); result = await controller.say(msg); }
    else if (command === "set") { if (!canAdmin(message.member)) throw new Error("Admin access required for server.properties."); const key = parts[2]; const value = parts.slice(3).join(" "); if (!key || !value) throw new Error("Usage: smc set <property> <value>"); if (["online-mode","white-list","enforce-whitelist","server-port"].includes(key)) throw new Error("That property is protected by SMC safety rules."); working = await message.reply("🟡 **Updating server**\nChanging `" + key + "`…"); result = await controller.propertySet(key, value); }
    else if (command === "kick") { if (!canAdmin(message.member)) throw new Error("Admin access required for kick."); working = await message.reply("🟡 **Kicking player**\nKicking `" + name + "`…"); result = await controller.kick(name); }
    else if (command === "ban") { if (!canAdmin(message.member)) throw new Error("Admin access required for ban."); working = await message.reply("🟡 **Banning player**\nBanning `" + name + "`…"); result = await controller.ban(name); }
    else if (command === "pardon" || command === "unban") { if (!canAdmin(message.member)) throw new Error("Admin access required for unban."); working = await message.reply("🟡 **Removing ban**\nRemoving the ban for `" + name + "`…"); result = await controller.pardon(name); }
    else if (command === "op") { if (!canAdmin(message.member)) throw new Error("Admin access required for op."); working = await message.reply("🟡 **Granting operator**\nGiving `" + name + "` operator access…"); result = await controller.op(name); }
    else if (command === "deop") { if (!canAdmin(message.member)) throw new Error("Admin access required for deop."); working = await message.reply("🟡 **Removing operator**\nRemoving operator access from `" + name + "`…"); result = await controller.deop(name); }
    else if (command === "save") { working = await message.reply("🟡 **Saving world**\nSaving the world…"); result = await controller.save(); }
    else if (command === "whitelist") { const sub = (parts[2] || "list").toLowerCase(); if (sub === "add") { working = await message.reply("🟡 **Updating whitelist**\nAdding `" + parts[3] + "` to the whitelist file…"); result = await controller.whitelistAdd(parts[3]); } else if (sub === "remove" || sub === "rm") { working = await message.reply("🟡 **Updating whitelist**\nRemoving `" + parts[3] + "` from the whitelist file…"); result = await controller.whitelistRemove(parts[3]); } else if (sub === "clear") { working = await message.reply("🟡 **Clearing whitelist**\nClearing the whitelist file…"); result = await controller.whitelistClear(); } else return message.reply(controller.formatWhitelist(await controller.liveStatus())); }
    else if (command === "command") { if (!canAdmin(message.member)) return message.reply("👑 **Admin access required for arbitrary Minecraft commands.**"); const raw = parts.slice(2).join(" "); if (!raw) throw new Error("Usage: smc command <minecraft command>"); working = await message.reply("🟡 **Running command**\nRunning `" + raw + "`…"); result = await controller.command(raw); }

    record(message, parts.slice(1).join(" "), "completed");

    if (working) {
      if (command === "start") return working.edit(`🟢 **Minecraft is online**\n${format(result)}`);
      if (command === "stop") return working.edit("⚫ **Minecraft is offline**\n\nThe server was stopped safely.");
      if (command === "restart") return working.edit(`🟢 **Minecraft restarted**\n${format(result)}`);
    }

    if (working) {
      const output = Array.isArray(result?.output)
        ? result.output.filter(Boolean).slice(-12).join("\n").replace(/\x60/g, "'").slice(-3000)
        : "";

      if (output) {
        return working.edit("🟢 **Action complete**\n```\n" + output + "\n```").catch(() => {});
      }

      const label = command === "set" ? "Updated " + parts[2] :
        command === "kick" ? "Kicked " + parts[2] :
        command === "ban" ? "Banned " + parts[2] :
        (command === "pardon" || command === "unban") ? "Ban removed for " + parts[2] :
        command === "op" ? "Gave " + parts[2] + " operator access" :
        command === "deop" ? "Removed operator access from " + parts[2] :
        command === "save" ? "World saved" :
        command === "say" ? "Message sent" :
        command === "whitelist" ? "Whitelist updated" :
        command === "command" ? "Minecraft command completed" :
        "Action completed";

      return working.edit(`🟢 **Done**\n${label}.`).catch(() => {});
    }

    return message.reply(`🟢 **Done**\n${parts.slice(1).join(" ")} completed successfully.`);
  } catch (error) {
    record(message, parts.slice(1).join(" "), "error");
    const errorText = String(error.message || error).replace(/\\`/g, "'");
    if (working) return working.edit(`🔴 **Action failed**\n${errorText}`).catch(() => {});
    return message.reply(`🔴 **Action failed**\n${errorText}`);
  }
}
client.on("messageCreate", async message => {
  if (message.author.bot || !message.guild) return;

  const parts = message.content.trim().split(/\s+/);
  if (parts[0]?.toLowerCase() !== "smc") return;
  const command = (parts[1] || "help").toLowerCase();
  if (command !== "admin" && !allowed(message.channelId)) return;

  try {
    await handle(message, parts);
  } catch (error) {
    await message.reply(`⚠️ **SMC error**\n${error.message || "SMC request failed."}`).catch(() => {});
  }
});

async function notify(text) {
  if (!config.notifyChannelId) return;
  try { const ch = await client.channels.fetch(config.notifyChannelId); if (ch?.isTextBased()) await ch.send(text); } catch (error) { console.error("Notification failed:", error.message); }
}
let monitorSnapshot = null;
let emptySince = null;
let crashRecovery = { key: null, attempts: 0, lastAttemptAt: 0 };
setInterval(async () => {
  try {
    const s = await controller.liveStatus();
    const compact = [s.codespace, s.minecraft, s.playit, s.publicAddress, s.players?.online ?? null].join("|");

    if (!controller.operation() && agent.info().desiredMinecraft === "running" &&
        (s.codespace !== "online" || s.agent !== "online" || s.minecraft !== "running")) {
      try {
        const recovered = await controller.recoverServer();
        if (recovered.minecraft === "running" && s.minecraft !== "running") {
          await notify("🟢 **SMC RECOVERY COMPLETE**\n\nMinecraft was automatically recovered because SMC still expected the server to be running.");
        }
      } catch (error) {
        console.error("SMC automatic recovery failed:", error.message);
      }
    }
    if (monitorSnapshot && compact !== monitorSnapshot) {
      const old = monitorSnapshot.split("|");
      if (s.minecraft !== old[1] && s.minecraft === "running") await notify("🟢 **Smarties is online**\n\nThe Minecraft world is back up and ready.");
      if (s.publicAddress && s.publicAddress !== old[3]) await notify("🌐 **Smarties • Minecraft Address**\n\n`" + s.publicAddress + "`");
    }

    if (s.crashed) {
      const key = `${s.lastCrashAt || "unknown"}:${s.lastExit ?? "unknown"}`;
      if (crashRecovery.key !== key) crashRecovery = { key, attempts: 0, lastAttemptAt: 0 };
      if (crashRecovery.attempts < config.crashMaxRetries && Date.now() - crashRecovery.lastAttemptAt >= config.crashCooldownMs && !controller.operation()) {
        crashRecovery.attempts += 1;
        crashRecovery.lastAttemptAt = Date.now();
        await notify("🚨 **Minecraft just crashed.\nExit code: **" + (s.lastExit ?? "unknown") + "**\nI’m going to try bringing it back up (attempt " + crashRecovery.attempts + "/" + config.crashMaxRetries + ").\n\nLast few log lines:\n```\n" + (s.logTail || []).slice(-8).join("\n").slice(-1800) + "\n```");
        try {
          await controller.restartServer();
          await notify("🟢 **RECOVERY COMPLETE**\nMinecraft started successfully after the crash.");
        } catch (error) {
          await notify(`⚠️ **Automatic recovery failed**\n${error.message}\n\nAutomatic retries have been stopped to prevent a restart loop.`);
        }
      } else if (crashRecovery.attempts >= config.crashMaxRetries && Date.now() - crashRecovery.lastAttemptAt >= config.crashCooldownMs) {
        await notify("🛑 **RECOVERY STOPPED**\nMinecraft crashed again, so automatic restarts have been paused.\n\nUse `smc crash` and `smc logs` to investigate.");
        crashRecovery.lastAttemptAt = Date.now();
      }
    }

    monitorSnapshot = compact;
    if (s.minecraft === "running" && s.players?.online === 0) {
      if (!emptySince) emptySince = Date.now();
      const idleMs = config.idleMinutes * 60 * 1000;
      if (idleMs > 0 && Date.now() - emptySince >= idleMs && !controller.operation()) {
        await notify(`🛌 **IDLE SHUTDOWN**\nNo players have been online for **${config.idleMinutes} minutes**.\nSMC is shutting the world down safely.`);
        try { await controller.stopServer(); } catch (error) { await notify("⚠️ **IDLE SHUTDOWN BLOCKED**\n" + error.message); }
        emptySince = null;
      }
    } else emptySince = null;
  } catch (error) { console.error("SMC monitor error:", error.message); }
}, 10000);
const json = (res, status, data) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
};

const server = http.createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/health"))
    return json(res, 200, { ok: true, operation: controller.operation(), agent: agent.info() });

  if (req.method !== "POST" || req.url !== "/agent/sync")
    return json(res, 404, { error: "not_found" });

  if (!agent.authenticated(req))
    return json(res, 401, { error: "unauthorized" });

  let body = "";
  req.on("data", chunk => {
    body += chunk;
    if (body.length > 1048576) req.destroy();
  });

  req.on("end", () => {
    try {
      return json(res, 200, agent.sync(JSON.parse(body || "{}").status));
    } catch (error) {
      return json(res, 400, { error: error.message || "invalid_request" });
    }
  });
});

server.listen(config.httpPort, "0.0.0.0", () =>
  console.log(`SMC control plane listening on ${config.httpPort}`)
);

client.once("ready", () => {
  console.log(
    `[Discord] READY — connected as ${client.user.tag} (${client.user.id})`
  );
});

async function discordPreflight() {
  const timeoutMs = 10000;
  const headers = {
    Authorization: `Bot ${config.discordToken}`,
    Accept: "application/json"
  };

  for (const [name, url] of [
    ["users/@me", "https://discord.com/api/v10/users/@me"],
    ["gateway/bot", "https://discord.com/api/v10/gateway/bot"]
  ]) {
    let response;
    try {
      response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      throw new Error(`Discord preflight ${name} request failed: ${error.message}`);
    }

    const body = await response.text();
    if (!response.ok) {
      let detail = body;
      let retryAfter = response.headers.get("retry-after");
      try {
        const parsed = JSON.parse(body);
        detail = parsed.message || body;
        retryAfter = parsed.retry_after ?? retryAfter;
      } catch {}

      if (response.status === 429) {
        console.warn(
          `[Discord] Preflight ${name} is rate-limited (HTTP 429). Retry-After: ${retryAfter ?? "unknown"}s. Continuing to Gateway login instead of crash-looping.`
        );
        return false;
      }

      throw new Error(`Discord preflight ${name} returned HTTP ${response.status}: ${detail}`);
    }

    if (name === "users/@me") {
      try {
        const user = JSON.parse(body);
        console.log(`[Discord] REST authentication OK — bot user: ${user.username}#${user.discriminator || "0"} (${user.id})`);
      } catch {
        console.log("[Discord] REST authentication OK.");
      }
    } else {
      try {
        const gateway = JSON.parse(body);
        console.log(`[Discord] Gateway endpoint OK — url available, recommended shards: ${gateway.shards ?? "unknown"}`);
      } catch {
        console.log("[Discord] Gateway endpoint OK.");
      }
    }
  }
}

async function connectDiscord() {
  console.log("[Discord] Starting Gateway login...");
  console.log("[Discord] DISCORD_TOKEN configured:", Boolean(config.discordToken));

  try {
    await discordPreflight();
  } catch (error) {
    console.error("[Discord] PRECHECK FAILED:", error?.stack || error);
    process.exit(1);
  }

  const timeoutMs = 30000;
  let attempt = 0;

  while (true) {
    attempt += 1;
    let timeout;

    try {
      console.log(`[Discord] Gateway connection attempt ${attempt}...`);

      await Promise.race([
        client.login(config.discordToken),
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`Discord Gateway login timed out after ${timeoutMs}ms.`)),
            timeoutMs
          );
        })
      ]);

      console.log("[Discord] login() completed; waiting for READY...");
      return;
    } catch (error) {
      console.error("[Discord] login failed:", error?.stack || error);

      const code = error?.code;
      if (code === 4004 || code === 4013 || code === 4014) {
        console.error(`[Discord] Fatal Gateway authentication/intent error ${code}; not retrying.`);
        process.exit(1);
      }

      console.warn("[Discord] Treating this as a transient Gateway/network failure.");
      try { client.destroy(); } catch {}

      const delayMs = Math.min(120000, 30000 * Math.pow(2, Math.min(attempt - 1, 2)));
      console.log(`[Discord] Retrying Gateway connection in ${Math.round(delayMs / 1000)}s...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    } finally {
      clearTimeout(timeout);
    }
  }
}

connectDiscord();
