# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Static guard: every name a tt_setup module *uses* must be importable/defined.

Catches dropped imports (e.g. a `from startup_checks import ...` that didn't make
it into a module) which would otherwise only fail at runtime on a code path the
unit tests don't exercise.
"""
import ast
import builtins
import os
import unittest

PKG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tt_setup")
_BUILTINS = set(dir(builtins)) | {"__file__", "__name__", "__doc__"}


def _has_func_or_class_ancestor(node, parents):
    cur = parents.get(id(node))
    while cur is not None:
        if isinstance(cur, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            return True
        cur = parents.get(id(cur))
    return False


def _module_level_names(tree, parents):
    """Names bound at module scope, including those inside module-level try/if."""
    names = set()
    star_modules = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            for a in node.names:
                if a.name == "*":
                    star_modules.append(node.module)
                else:
                    names.add(a.asname or a.name)
        elif isinstance(node, ast.Import):
            for a in node.names:
                names.add((a.asname or a.name).split(".")[0])
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            if not _has_func_or_class_ancestor(node, parents):
                names.add(node.name)
        elif isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
            if not _has_func_or_class_ancestor(node, parents):
                names.add(node.id)
    return names, star_modules


def _star_exports(module_dotted):
    """Public (non-underscore) names a `from X import *` would bring in."""
    mod = __import__(module_dotted, fromlist=["*"])
    return {n for n in vars(mod) if not n.startswith("_")}


def _locals_guarded_names(tree):
    """Names referenced only behind `if 'name' in locals()/globals()` guards."""
    guarded = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Compare) and node.ops and isinstance(node.ops[0], ast.In):
            left = node.left
            right = node.comparators[0] if node.comparators else None
            if (isinstance(left, ast.Constant) and isinstance(left.value, str)
                    and isinstance(right, ast.Call) and isinstance(right.func, ast.Name)
                    and right.func.id in ("locals", "globals")):
                guarded.add(left.value)
    return guarded


def _function_locals(func):
    locs = set()
    a = func.args
    for arg in list(a.posonlyargs) + list(a.args) + list(a.kwonlyargs):
        locs.add(arg.arg)
    if a.vararg:
        locs.add(a.vararg.arg)
    if a.kwarg:
        locs.add(a.kwarg.arg)
    for node in ast.walk(func):
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
            locs.add(node.id)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            locs.add(node.name)
        elif isinstance(node, ast.Import):
            for al in node.names:
                locs.add((al.asname or al.name).split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            for al in node.names:
                if al.name != "*":
                    locs.add(al.asname or al.name)
        elif isinstance(node, ast.ExceptHandler) and node.name:
            locs.add(node.name)
    return locs


class TestNoUndefinedNames(unittest.TestCase):
    def test_all_modules_have_resolvable_names(self):
        offenders = []
        for fname in sorted(os.listdir(PKG_DIR)):
            if not fname.endswith(".py"):
                continue
            with open(os.path.join(PKG_DIR, fname)) as f:
                tree = ast.parse(f.read())
            parents = {}
            for node in ast.walk(tree):
                for child in ast.iter_child_nodes(node):
                    parents[id(child)] = node

            available, star_mods = _module_level_names(tree, parents)
            for sm in star_mods:
                available |= _star_exports(sm)
            available |= _locals_guarded_names(tree)

            funcs = [n for n in ast.walk(tree)
                     if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
            func_locals = {id(f): _function_locals(f) for f in funcs}

            def enclosing(node):
                acc = set()
                cur = parents.get(id(node))
                while cur is not None:
                    if isinstance(cur, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        acc |= func_locals.get(id(cur), set())
                    cur = parents.get(id(cur))
                return acc

            for node in ast.walk(tree):
                if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
                    n = node.id
                    if n in _BUILTINS or n in available:
                        continue
                    if n in enclosing(node):
                        continue
                    offenders.append(f"{fname}:{node.lineno} undefined name '{n}'")

        self.assertEqual(offenders, [], "Unresolved names:\n  " + "\n  ".join(offenders))


if __name__ == "__main__":
    unittest.main()
