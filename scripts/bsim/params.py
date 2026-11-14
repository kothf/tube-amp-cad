import re, sys, json
def table(dev_c, mpar_c, pfx, tname):
    src = open(dev_c).read()
    t = src[src.index(tname):]
    t = t[:t.index('};')]
    ids = {}
    for mo in re.finditer(r'IOPR?A?U?\s*\(\s*"(\w+)"\s*,\s*(\w+)\s*,\s*IF_(\w+)', t):
        ids.setdefault(mo.group(2), []).append((mo.group(1).lower(), mo.group(3)))
    mp = open(mpar_c).read()
    out = {}
    for mo in re.finditer(r'case\s+(\w+)\s*:(.*?)break;', mp, flags=re.S):
        cid, body = mo.group(1), mo.group(2)
        f = re.search(r'mod->%s(\w+)\s*=\s*value->(\w)Value' % pfx, body)
        if not f or cid not in ids: continue
        for name, typ in ids[cid]:
            out[name] = f.group(1)
    return out
