'use strict';

/* Entry point for the vendored editor bundle (built with esbuild, see the
   "build:editor" npm script). Exposes the Toast UI Editor and its plugins
   as globals for the renderer. */

import Editor from '@toast-ui/editor';
import codeSyntaxHighlight from '@toast-ui/editor-plugin-code-syntax-highlight';
import Prism from 'prismjs';

// Extra languages on top of Prism's defaults (markup, css, clike, javascript).
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-powershell';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-sql';

window.toastui = { Editor };
window.rendlEditorPlugins = { codeSyntaxHighlight, Prism };
