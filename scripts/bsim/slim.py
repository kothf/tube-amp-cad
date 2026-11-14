import re, sys
def slim(t):
    head_end = t.index('(function (root) {')
    head, body = t[:head_end], t[head_end:]
    body = re.sub(r'/\*(?!\s*eslint).*?\*/', '', body, flags=re.S)
    out = []
    for l in body.split('\n'):
        if not l.strip(): continue
        out.append(l.rstrip())
    # reduce deep indents to 2 spaces per level approx: strip leading whitespace beyond 4
    out = [re.sub(r'^ {5,}', lambda m: '    ' + ' ' * ((len(m.group(0)) - 4) // 4), l) for l in out]
    return head + '\n'.join(out) + '\n'
