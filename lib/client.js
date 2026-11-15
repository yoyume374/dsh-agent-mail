window.__ModuleLoader__.load({
	id: "dsh-agent-mail",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let React = require("react");
		const h = React.createElement;
		const inject = ["slots", "connection"];
		const BUILD = "0.3.8";
		function callHost(rpc, method, request) {
			return rpc.call("/api", "agentMail/" + method, { args: { request: request } }).then(function (result) {
				if (!result.ok) {
					const reason = result.error && result.error.message ? result.error.message : "agent mail 服务暂不可用";
					throw new Error(reason);
				}
				return result.value;
			});
		}
		function formatTime(value) {
			if (!value) return "";
			const date = new Date(value);
			if (Number.isNaN(date.getTime())) return value;
			return date.toLocaleString("zh-CN", { hour12: false });
		}
		function shortId(value) {
			return String(value || "").replace(/^session-/, "").slice(0, 8);
		}
		function basename(value) {
			const parts = String(value || "").split(/[\\/]/).filter(Boolean);
			return parts.length > 0 ? parts[parts.length - 1] : "";
		}
		function messageOf(error) {
			return String(error && error.message ? error.message : error);
		}
		const styles = {
			wrap: { display: "flex", flexDirection: "column", gap: "10px", padding: "16px", height: "100%", overflow: "auto", fontSize: "13px" },
			bar: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
			title: { fontWeight: 600, fontSize: "14px" },
			muted: { opacity: 0.65 },
			hint: { opacity: 0.5, fontSize: "12px" },
			button: { padding: "2px 10px", height: "24px", borderRadius: "6px", border: "1px solid var(--dsh-border, rgba(128,128,128,0.4))", background: "transparent", color: "inherit", cursor: "pointer", fontSize: "12px" },
			primary: { padding: "2px 12px", height: "26px", borderRadius: "6px", border: "1px solid var(--dsh-accent, #4c8dff)", background: "var(--dsh-accent, #4c8dff)", color: "#fff", cursor: "pointer", fontSize: "12px" },
			group: { display: "flex", flexDirection: "column", gap: "4px", padding: "10px", borderRadius: "10px", border: "1px solid var(--dsh-border, rgba(128,128,128,0.25))" },
			groupHead: { display: "flex", alignItems: "baseline", gap: "8px" },
			groupSubject: { fontWeight: 600, flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
			people: { opacity: 0.6, fontSize: "12px", marginBottom: "2px" },
			row: { display: "flex", gap: "8px", alignItems: "baseline", padding: "6px 8px", borderRadius: "6px", cursor: "pointer" },
			rowOpen: { background: "rgba(128,128,128,0.1)" },
			dir: { width: "12px", flex: "0 0 auto", opacity: 0.8, fontWeight: 600 },
			who: { flex: "0 0 auto", minWidth: "96px", opacity: 0.85 },
			rowSubject: { flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
			state: { flex: "0 0 auto", fontSize: "11px", opacity: 0.7 },
			dot: { width: "6px", height: "6px", borderRadius: "50%", background: "#4c8dff", flex: "0 0 auto", marginTop: "6px" },
			meta: { flex: "0 0 auto", opacity: 0.55, fontSize: "12px" },
			body: { margin: "0 0 4px 20px", padding: "8px 10px", whiteSpace: "pre-wrap", background: "rgba(128,128,128,0.08)", borderRadius: "8px" },
			error: { color: "#e5484d", whiteSpace: "pre-wrap" },
			ok: { color: "#2f9e44", fontSize: "12px" },
			panel: { display: "flex", flexDirection: "column", gap: "10px", padding: "12px", borderRadius: "10px", border: "1px solid var(--dsh-border, rgba(128,128,128,0.25))" },
			field: { display: "flex", flexDirection: "column", gap: "2px", padding: "6px 0", borderBottom: "1px solid rgba(128,128,128,0.12)" },
			fieldHead: { display: "flex", alignItems: "center", gap: "8px" },
			fieldLabel: { fontWeight: 600, minWidth: "170px" },
			input: { width: "96px", padding: "2px 6px", height: "24px", borderRadius: "6px", border: "1px solid var(--dsh-border, rgba(128,128,128,0.4))", background: "transparent", color: "inherit", fontSize: "12px" },
			badge: { fontSize: "11px", padding: "0 6px", borderRadius: "10px", border: "1px solid var(--dsh-border, rgba(128,128,128,0.4))", opacity: 0.8 },
		};

		function toggleDraft(draft, key, value) {
			const next = Object.assign({}, draft);
			next[key] = value;
			return next;
		}

		function SettingsPanel(props) {
			const form = props.form;
			const setForm = props.setForm;
			const save = props.save;
			const resetAll = props.resetAll;
			const busy = props.busy;
			if (!form) return h("div", { style: styles.panel }, h("div", { style: styles.muted }, "读取设置…"));
			if (form.error) return h("div", { style: styles.panel }, h("div", { style: styles.error }, form.error));
			const fields = [];
			for (const row of form.rows) {
				const draft = form.draft[row.key];
				let control;
				if (row.type === "boolean") {
					control = h("input", {
						type: "checkbox",
						checked: draft === true,
						onChange: function (event) { setForm(Object.assign({}, form, { draft: toggleDraft(form.draft, row.key, event.target.checked) })); },
					});
				} else {
					control = h("input", {
						type: "number",
						style: styles.input,
						min: row.min,
						max: row.max,
						value: draft === undefined || draft === null ? "" : draft,
						onChange: function (event) { setForm(Object.assign({}, form, { draft: toggleDraft(form.draft, row.key, event.target.value) })); },
					});
				}
				const head = [
					h("span", { key: "label", style: styles.fieldLabel }, row.label),
					control,
				];
				if (row.overridden) {
					head.push(h("span", { key: "badge", style: styles.badge }, "已覆盖配置"));
					head.push(h("button", {
						key: "reset",
						style: styles.button,
						onClick: function () { props.resetOne(row.key); },
					}, "用配置值"));
				}
				const hintText = row.hint + (row.overridden ? "（配置文件值：" + row.configured + "）" : "");
				fields.push(h("div", { key: row.key, style: styles.field },
					h("div", { style: styles.fieldHead }, head),
					hintText ? h("div", { style: styles.hint }, hintText) : null,
				));
			}
			return h("div", { style: styles.panel },
				h("div", { style: styles.bar },
					h("span", { style: styles.title }, "设置"),
					h("span", { style: styles.muted }, form.wakeSummary),
				),
				h("div", { style: styles.hint }, "这里的改动立即生效（不用重启）。保存在数据目录的 settings.json，覆盖 profile 里的插件配置；「用配置值」清除该覆盖。版本 " + BUILD),
				fields,
				props.error ? h("div", { style: styles.error }, props.error) : null,
				props.note ? h("div", { style: styles.ok }, props.note) : null,
				h("div", { style: styles.bar },
					h("button", { style: styles.primary, disabled: busy, onClick: save }, busy ? "保存中…" : "保存"),
					h("button", { style: styles.button, disabled: busy, onClick: resetAll }, "全部恢复配置值"),
				),
			);
		}

		function useSettingsForm(call, enabled) {
			const [form, setForm] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState("");
			const [note, setNote] = React.useState("");
			const load = React.useCallback(function () {
				if (!enabled) return;
				call("settings", {}).then(function (value) {
					const draft = {};
					for (const row of value.rows) draft[row.key] = row.value;
					setForm({ rows: value.rows, draft: draft, wakeSummary: value.wakeSummary });
				}).catch(function (cause) {
					setForm({ rows: [], draft: {}, error: messageOf(cause) });
				});
			}, [call, enabled]);
			React.useEffect(function () { load(); }, [load]);
			const saveValues = React.useCallback(function (values) {
				setBusy(true);
				setError("");
				setNote("");
				return call("updateSettings", { values: values }).then(function (value) {
					const draft = {};
					for (const row of value.rows) draft[row.key] = row.value;
					setForm({ rows: value.rows, draft: draft, wakeSummary: value.wakeSummary });
					setNote("已保存并生效");
				}).catch(function (cause) {
					setError(messageOf(cause));
				}).then(function () { setBusy(false); });
			}, [call]);
			const save = React.useCallback(function () {
				if (!form || form.error) return;
				const values = {};
				for (const row of form.rows) {
					const draft = form.draft[row.key];
					if (row.type === "number") {
						if (draft === "" || draft === null || draft === undefined) continue;
						if (Number(draft) !== row.value) values[row.key] = Number(draft);
					} else if (draft !== row.value) {
						values[row.key] = draft;
					}
				}
				if (Object.keys(values).length === 0) { setNote("没有改动"); return; }
				saveValues(values);
			}, [form, saveValues]);
			const resetOne = React.useCallback(function (key) {
				const values = {};
				values[key] = null;
				saveValues(values);
			}, [saveValues]);
			const resetAll = React.useCallback(function () {
				if (!form || form.error) return;
				const values = {};
				for (const row of form.rows) values[row.key] = null;
				saveValues(values);
			}, [form, saveValues]);
			return { form: form, setForm: setForm, busy: busy, error: error, note: note, save: save, resetOne: resetOne, resetAll: resetAll };
		}

		function RowConfigPage(props) {
			const call = props.call;
			const settings = useSettingsForm(call, props.view !== "summary");
			if (props.view === "summary") return "自动唤醒、限流与容量参数在这里修改，不必编辑配置文件。（版本 " + BUILD + "）";
			return h("div", { style: { display: "flex", flexDirection: "column", gap: "10px", maxWidth: "760px" } },
				h(SettingsPanel, {
					form: settings.form,
					setForm: settings.setForm,
					save: settings.save,
					resetAll: settings.resetAll,
					resetOne: settings.resetOne,
					busy: settings.busy,
					error: settings.error,
					note: settings.note,
				}),
			);
		}

		function MailView(props) {
			const call = props.call;
			const useSession = props.useSession;
			const pick = function (value) {
				if (typeof value === "string") return value;
				if (value && typeof value === "object") return String(value.id || value.sessionId || value);
				return "";
			};
			const fromInject = pick(props.sessionId);
			const fromHook = !fromInject && typeof useSession === "function" ? pick(useSession(function (snapshot) { return snapshot ? snapshot.id || snapshot : ""; })) : "";
			const sessionId = fromInject || fromHook;
			const [state, setState] = React.useState({ groups: [], unread: 0, labels: {}, error: "", loading: true });
			const [open, setOpen] = React.useState({ id: "", body: "" });
			const [showSettings, setShowSettings] = React.useState(false);
			const settings = useSettingsForm(call, showSettings);
			const reload = React.useCallback(function () {
				if (!sessionId) {
					setState({ groups: [], unread: 0, labels: {}, error: "当前视图没有会话身份，无法读取邮件。", loading: false });
					return;
				}
				setState(function (previous) { return Object.assign({}, previous, { error: "", loading: true }); });
				Promise.all([
					call("threads", { sessionId: sessionId, limit: 30 }),
					call("peers", { sessionId: sessionId }).catch(function () { return []; }),
				]).then(function (values) {
					const labels = {};
					for (const peer of values[1] || []) {
						// Session titles are what the user can rename in the sidebar; a folder name is only a fallback.
						const label = peer.name || basename(peer.cwd) || shortId(peer.sessionId);
						labels[peer.sessionId] = label;
					}
					setState({ groups: values[0].groups, unread: values[0].unread, labels: labels, error: "", loading: false });
				}).catch(function (error) {
					setState({ groups: [], unread: 0, labels: {}, error: messageOf(error), loading: false });
				});
			}, [call, sessionId]);
			React.useEffect(function () { reload(); }, [reload]);
			const label = React.useCallback(function (id) {
				if (id === sessionId) return "我";
				return state.labels[id] || shortId(id);
			}, [sessionId, state.labels]);
			const openMail = React.useCallback(function (mail) {
				if (open.id === mail.id) {
					setOpen({ id: "", body: "" });
					return;
				}
				setOpen({ id: mail.id, body: "读取中…" });
				call("peek", { sessionId: sessionId, id: mail.id }).then(function (value) {
					setOpen({ id: mail.id, body: value.body });
				}).catch(function (error) {
					setOpen({ id: "", body: "" });
					setState(function (previous) { return Object.assign({}, previous, { error: messageOf(error) }); });
				});
			}, [call, open.id, sessionId]);

			const header = [
				h("span", { key: "title", style: styles.title }, "邮件"),
				h("span", { key: "unread", style: styles.muted }, state.unread > 0 ? "agent 未读 " + state.unread + " 封" : "没有未读"),
				h("span", { key: "gap", style: { flex: "1 1 auto" } }),
				h("button", { key: "settings", style: styles.button, onClick: function () { showSettings ? setShowSettings(false) : setShowSettings(true); } }, showSettings ? "返回邮件" : "设置"),
				showSettings ? null : h("button", { key: "refresh", style: styles.button, onClick: reload }, "刷新"),
			];

			const children = [h("div", { key: "bar", style: styles.bar }, header)];
			if (showSettings) {
				children.push(h(SettingsPanel, {
					key: "settings",
					form: settings.form,
					setForm: settings.setForm,
					save: settings.save,
					resetAll: settings.resetAll,
					resetOne: settings.resetOne,
					busy: settings.busy,
					error: settings.error,
					note: settings.note,
				}));
				return h("div", { style: styles.wrap }, children);
			}
			children.push(h("div", { key: "hint", style: styles.hint }, "已读由 agent 自己读取决定；这里展开只会查看正文，不会改变已读状态。"));
			if (state.error) children.push(h("div", { key: "err", style: styles.error }, state.error));
			if (!state.loading && state.groups.length === 0 && !state.error) {
				children.push(h("div", { key: "empty", style: styles.muted }, "这个会话还没有收发过邮件。"));
				children.push(h("div", { key: "addr", style: styles.meta }, "本会话地址：" + sessionId));
			}
			for (const group of state.groups) {
				const subjectOf = {};
				for (const mail of group.mails) subjectOf[mail.id] = mail.subject;
				const rows = [];
				for (const mail of group.mails) {
					const parentSubject = mail.replyTo && subjectOf[mail.replyTo] ? subjectOf[mail.replyTo] : "";
					rows.push(h("div", { key: "row-" + mail.id, style: Object.assign({}, styles.row, open.id === mail.id ? styles.rowOpen : {}), onClick: function () { openMail(mail); } },
						h("span", { style: styles.dir }, mail.direction === "out" ? "→" : "←"),
						h("span", { style: styles.who }, label(mail.from) + " → " + label(mail.to)),
						h("span", { style: styles.rowSubject }, parentSubject ? "回复《" + parentSubject + "》" : mail.subject),
						h("span", { style: styles.state }, mail.direction === "out" ? "已发出" : (mail.readAt ? "agent 已读" : "agent 未读")),
						h("span", { style: styles.meta }, formatTime(mail.createdAt)),
					));
					if (open.id === mail.id) rows.push(h("div", { key: "body-" + mail.id, style: styles.body }, open.body));
				}
				children.push(h("div", { key: "group-" + group.rootId, style: styles.group },
					h("div", { style: styles.groupHead },
						group.unread > 0 ? h("span", { style: styles.dot }) : null,
						h("span", { style: styles.groupSubject }, group.subject),
						h("span", { style: styles.meta }, group.count + " 封 · " + formatTime(group.lastAt)),
					),
					h("div", { style: styles.people }, group.participants.map(label).join("  ⇄  ")),
					rows,
				));
			}
			return h("div", { style: styles.wrap }, children);
		}

		function apply(ctx) {
			const connection = ctx.connection;
			const call = function (method, args) { return callHost(connection.rpc, method, args); };
			ctx.effect(function () {
				return ctx.slots.inject("conversation.view", function () {
					return ctx.slots.register({
						name: "conversation.view",
						id: "agent-mail",
						order: 40,
						label: function () { return "邮件"; },
						inject: function (sessionId) {
							return {
								sessionId: typeof sessionId === "string" ? sessionId : (sessionId === undefined ? "" : String(sessionId)),
								call: call,
							};
						},
					}, MailView);
				});
			}, "agentMail.view");
			ctx.effect(function () {
				return ctx.slots.inject("plugins.row.config", function () {
					return ctx.slots.register({
						name: "plugins.row.config",
						key: "dsh-agent-mail#agent-mail",
					}, function (props) {
						return h(RowConfigPage, Object.assign({}, props, {
							call: call,
						}));
					});
				});
			}, "agentMail.pluginConfig");
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
