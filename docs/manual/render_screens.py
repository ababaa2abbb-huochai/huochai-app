"""Render each .dc.html artboard to a PNG with a tiny stand-in for the DC runtime."""
import json, re, sys, html
from pathlib import Path
from playwright.sync_api import sync_playwright

SRC = Path(sys.argv[1])
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)

BOARDS = [("Main", 844), ("Availability", 844), ("Ignite", 1900), ("Invite", 844), ("Status", 844)]

RUNTIME = r"""
class DCLogic { constructor(props){ this.props = props || {}; this.state = null; } setState(s){ this.state = Object.assign({}, this.state || {}, s); } }
function getv(path, scope){ path = path.trim(); if (path === 'true') return true; if (path === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
  return path.split('.').reduce(function(o,k){ return o == null ? undefined : o[k]; }, scope); }
function interp(str, scope){ return str.replace(/\{\{\s*([^}]+?)\s*\}\}/g, function(m,p){ var v = getv(p, scope); return v == null ? '' : String(v); }); }
function holePath(str){ var m = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/.exec(str || ''); return m ? m[1] : null; }
function render(node, scope, parent){
  if (node.nodeType === 3) { parent.appendChild(document.createTextNode(interp(node.nodeValue, scope))); return; }
  if (node.nodeType !== 1) return;
  var tag = node.tagName.toLowerCase();
  if (tag === 'sc-for') {
    var list = getv(holePath(node.getAttribute('list')), scope) || [];
    var as = node.getAttribute('as') || 'item';
    list.forEach(function(item, i){ var s2 = Object.create(scope); s2[as] = item; s2.$index = i;
      node.childNodes.forEach(function(c){ render(c, s2, parent); }); });
    return;
  }
  if (tag === 'sc-if') {
    if (getv(holePath(node.getAttribute('value')), scope)) node.childNodes.forEach(function(c){ render(c, scope, parent); });
    return;
  }
  if (tag === 'helmet') return;
  var el = node.cloneNode(false);
  Array.from(el.attributes).forEach(function(a){
    if (/^on/i.test(a.name) || a.name.indexOf('hint-') === 0) { el.removeAttribute(a.name); return; }
    if (a.value.indexOf('{{') !== -1) el.setAttribute(a.name, interp(a.value, scope));
  });
  parent.appendChild(el);
  var kids = node.content ? node.content.childNodes : node.childNodes;
  kids.forEach(function(c){ render(c, scope, el); });
}
"""

def build(name):
    src = (SRC / f"{name}.dc.html").read_text(encoding="utf-8")
    body = re.search(r"<x-dc>(.*)</x-dc>", src, re.S).group(1)
    style = "\n".join(re.findall(r"<style>(.*?)</style>", body, re.S))
    body = re.sub(r"<helmet>.*?</helmet>", "", body, flags=re.S)
    m = re.search(r"<script type=\"text/x-dc\" data-dc-script data-props='(.*?)'>(.*?)</script>", src, re.S)
    props = json.loads(html.unescape(m.group(1)))
    defaults = {k: v.get("default") for k, v in props.items() if not k.startswith("$") and isinstance(v, dict)}
    code = m.group(2)
    return f"""<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8">
<style>{style}
*{{font-family:'Noto Sans CJK TC','Noto Sans TC',sans-serif !important}}
body{{margin:0;background:#fff}}</style></head><body>
<template id="t">{body}</template><div id="out"></div>
<script>{RUNTIME}
{code}
var c = new Component({json.dumps(defaults)});
var vals = c.renderVals();
var t = document.getElementById('t');
t.content.childNodes.forEach(function(n){{ render(n, vals, document.getElementById('out')); }});
</script></body></html>"""

with sync_playwright() as p:
    b = p.chromium.launch()
    for name, h in BOARDS:
        pg = b.new_page(viewport={"width": 390, "height": h}, device_scale_factor=2, locale="zh-TW")
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.set_content(build(name))
        pg.wait_for_timeout(300)
        pg.locator("#out > div").first.screenshot(path=str(OUT / f"{name}.png"))
        print(name, "errors:", errs)
    b.close()
