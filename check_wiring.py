import re, glob, os
html = open("index.html", encoding="utf-8").read()
html_ids = set(re.findall(r'id="([\w-]+)"', html))
js = ""
for f in ["app.js", "app2.js", "app3.js", "widgets.js"]:
    js += open(f, encoding="utf-8").read()
used = set(re.findall(r"""\$\(\s*["']([\w-]+)["']\s*\)""", js)) | set(re.findall(r"""getElementById\(\s*["']([\w-]+)["']""", js))
missing = sorted(used - html_ids)
print("ids used in JS :", len(used))
print("ids missing in HTML:", missing or "none")

css = ""
for f in ["styles.css", "styles2.css", "styles3.css"]:
    css += open(f, encoding="utf-8").read()
css_classes = set(re.findall(r"\.([A-Za-z][\w-]*)", css))
wjs = open("widgets.js", encoding="utf-8").read() + open("app2.js", encoding="utf-8").read() + open("app3.js", encoding="utf-8").read()
used_classes = set()
for m in re.findall(r"""["']((?:wx|item|verdict|ans|src)[\w -]*)["']""", wjs):
    used_classes.update(x for x in m.split(" ") if x)
unstyled = sorted(c for c in used_classes if c not in css_classes and not c.endswith("-")
                  and not re.search(r'id="%s"' % c, html))
print("widget/app classes with no CSS rule:", unstyled or "none")
print("stylesheets:", sorted(f for f in os.listdir(".") if f.endswith(".css")))
print("assets loaded by index.html:",
      [t for t in ["styles.css", "styles2.css", "styles3.css", "exam-data.js", "widgets.js",
                   "app.js", "app2.js", "app3.js"] if t in html])
print("assets present but NOT loaded:",
      [f for f in os.listdir(".") if f.endswith((".js", ".css")) and f not in html
       and f not in ("exam-data.json", "test_widgets.js")])
print("body.wide rules:", len(re.findall(r"body\.wide", css)))
