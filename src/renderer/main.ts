// 入口保持轻量，使应用模块加载失败时仍能显示提示并重新加载。
void import("./bootstrap").catch((error: unknown) => {
  console.error("战双助手界面加载失败：", error);
  const status = document.createElement("main");
  status.id = "startup-status";
  status.setAttribute("role", "alert");
  const heading = document.createElement("h1");
  heading.textContent = "界面加载失败";
  const message = document.createElement("p");
  message.textContent = "请重新加载；如果仍无法打开，请关闭窗口后重新启动。";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "重新加载";
  retry.addEventListener("click", () => window.location.reload());
  status.append(heading, message, retry);
  document.getElementById("app")?.replaceChildren(status);
});
