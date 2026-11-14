import re, sys
def c2js(src, pfx):
    s = src
    # comments: keep /* */ as is (valid JS)
    s = re.sub(r'^\s*#.*$', '', s, flags=re.M)
    s = re.sub(r'\b(?:fprintf|printf)\s*\((?:[^;]|"[^"]*")*?\)\s*;', ';', s, flags=re.S)
    s = re.sub(r'SPfrontEnd->IFerrorf\s*\(.*?\)\s*;', 'throw new Error("BSIM: effective channel size <= 0");', s, flags=re.S)
    s = re.sub(r'error\s*=\s*ACM_\w+\s*\(.*?\)\s*;', 'throw new Error("BSIM: ACM area calculation is not supported");', s, flags=re.S)
    s = re.sub(r'if\s*\(error\)\s*return\s*\(error\)\s*;', '', s)
    s = re.sub(r'model->%s(\w+)Given' % pfx, r'g.\1', s)
    s = re.sub(r'model->%s(\w+)' % pfx, r'm.\1', s)
    s = re.sub(r'here->%s(\w+)Given' % pfx, r'hg.\1', s)
    s = re.sub(r'here->%s(\w+)' % pfx, r'h.\1', s)
    s = re.sub(r'pParam->%s(\w+)' % pfx, r'pParam.\1', s)
    s = re.sub(r'ckt->CKT(\w+)', r'ckt.\1', s)
    s = re.sub(r'model->(\w+)', r'm.\1', s)
    s = re.sub(r'here->(\w+)', r'h.\1', s)
    s = re.sub(r'pParam->(\w+)', r'pParam.\1', s)
    s = s.replace('->', '.')
    s = re.sub(r'\bstruct\s+\w+\s*\*\s*(\w+)', r'let \1', s)
    s = re.sub(r'\bTMALLOC\s*\([^)]*\)', '{}', s)
    s = re.sub(r'\bFREE\s*\(\w+\)\s*;', '', s)
    s = re.sub(r'\bNULL\b', 'null', s)
    s = re.sub(r'\bTRUE\b', 'true', s); s = re.sub(r'\bFALSE\b', 'false', s)
    s = re.sub(r'\(double\)\s*', '', s); s = re.sub(r'\(int\)\s*', 'Math.trunc', s)
    for f, j in [('fabs','Math.abs'),('sqrt','Math.sqrt'),('exp','Math.exp'),('log10','Math.log10'),('log','Math.log'),('pow','Math.pow'),('MAX','Math.max'),('MIN','Math.min'),('tanh','Math.tanh'),('atan','Math.atan'),('floor','Math.floor'),('ceil','Math.ceil')]:
        s = re.sub(r'(?<![\.\w])%s\s*\(' % f, j + '(', s)
    # declarations
    def decl(mo):
        body = mo.group(2)
        body = re.sub(r'\*\s*(\w+)', r'\1', body)
        return mo.group(1) + 'let ' + body + ';'
    s = re.sub(r'^(\s*)(?:double|int|long|unsigned|register)\s+(?:double\s+|int\s+)?([^;(]*?);', decl, s, flags=re.M)
    s = re.sub(r'\bgoto\s+(\w+)\s*;', r'break \1;', s)
    s = re.sub(r'\breturn\s*\(\s*OK\s*\)\s*;', 'return;', s)
    return s
