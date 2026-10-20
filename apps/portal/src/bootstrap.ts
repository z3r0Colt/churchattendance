// Configuration/module errors must leave a useful page before any account data loads.
void import("./main").catch(() => {
  const root = document.getElementById("root")!;
  const heading = document.createElement("h1");
  heading.textContent = "Church configuration required";
  const detail = document.createElement("p");
  detail.textContent = "This portal could not open its approved church deployment. Contact the service operator.";
  root.replaceChildren(heading, detail);
  root.setAttribute("role", "alert");
});
