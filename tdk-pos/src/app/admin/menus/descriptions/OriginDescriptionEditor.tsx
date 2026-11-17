"use client";

import { useLayoutEffect, useRef } from "react";
import { decodeQrOriginDocument, encodeQrOriginDocument, type QrOriginDocument } from "@/lib/qr-menu-description-model";

function renderDocument(root: HTMLElement, document: QrOriginDocument) {
  const fragment = window.document.createDocumentFragment();
  let offset = 0;
  let rangeIndex = 0;
  while (offset < document.text.length) {
    while (rangeIndex < document.boldRanges.length && document.boldRanges[rangeIndex][1] <= offset) rangeIndex += 1;
    const currentRange = document.boldRanges[rangeIndex];
    const isBold = Boolean(currentRange && currentRange[0] <= offset && offset < currentRange[1]);
    const segmentEnd = Math.min(currentRange ? (isBold ? currentRange[1] : currentRange[0]) : document.text.length, document.text.length);
    const end = Math.max(offset + 1, segmentEnd);
    const textNode = window.document.createTextNode(document.text.slice(offset, end));
    if (isBold) {
      const strong = window.document.createElement("strong");
      strong.append(textNode);
      fragment.append(strong);
    } else fragment.append(textNode);
    offset = end;
  }
  root.replaceChildren(fragment);
}

function readDocument(root: HTMLElement): QrOriginDocument {
  let text = "";
  const boldRanges: QrOriginDocument["boldRanges"] = [];
  const appendText = (value: string, bold: boolean) => {
    const start = text.length;
    text += value;
    if (bold && value) boldRanges.push([start, text.length]);
  };
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const textNode = node as Text;
      appendText(textNode.data, Boolean(textNode.parentElement?.closest("strong,b")));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as HTMLElement;
    if (element.tagName === "BR") {
      appendText("\n", false);
      return;
    }
    const block = element.tagName === "DIV" || element.tagName === "P";
    if (block && text && !text.endsWith("\n")) appendText("\n", false);
    for (const child of [...element.childNodes]) visit(child);
    if (block && element.nextSibling && !text.endsWith("\n")) appendText("\n", false);
  };
  for (const child of [...root.childNodes]) {
    visit(child);
  }
  return { text, boldRanges };
}

function selectionBelongsTo(root: HTMLElement, range: Range) {
  return root.contains(range.startContainer) && root.contains(range.endContainer);
}

function fragmentIsBold(fragment: DocumentFragment) {
  const walker = window.document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
  let foundText = false;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!(node.parentElement?.closest("strong,b"))) return false;
    foundText = true;
  }
  return foundText;
}

function removeBoldElements(node: Node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const element = node as HTMLElement;
  for (const child of [...element.childNodes]) removeBoldElements(child);
  if (element.tagName === "STRONG" || element.tagName === "B") element.replaceWith(...element.childNodes);
}

export default function OriginDescriptionEditor({ value, onChange, disabled }: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastValidDocumentRef = useRef<QrOriginDocument>(decodeQrOriginDocument(value));
  const savedSelectionRef = useRef<Range | null>(null);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    renderDocument(editor, lastValidDocumentRef.current);
  }, []);

  const reportChange = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const document = readDocument(editor);
    if (document.text.length > 10000) {
      renderDocument(editor, lastValidDocumentRef.current);
      return;
    }
    lastValidDocumentRef.current = document;
    onChange(encodeQrOriginDocument(document));
  };

  const insertPlainText = (text: string) => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!selectionBelongsTo(editor, range)) return;
    range.deleteContents();
    const textNode = window.document.createTextNode(text);
    range.insertNode(textNode);
    range.setStart(textNode, textNode.length);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    savedSelectionRef.current = null;
    reportChange();
  };

  const saveSelection = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!range.collapsed && selectionBelongsTo(editor, range)) savedSelectionRef.current = range.cloneRange();
  };

  const toggleBold = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor) return;
    const currentRange = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const range = currentRange && !currentRange.collapsed && selectionBelongsTo(editor, currentRange)
      ? currentRange : savedSelectionRef.current;
    if (!range || range.collapsed) return;
    if (!selectionBelongsTo(editor, range) || !range.toString()) return;

    const extracted = range.extractContents();
    const makeNormal = fragmentIsBold(extracted);
    let replacement: Node;
    if (makeNormal) {
      for (const child of [...extracted.childNodes]) removeBoldElements(child);
      replacement = extracted;
    } else {
      const strong = window.document.createElement("strong");
      strong.append(extracted);
      replacement = strong;
    }
    const lastNode = replacement.lastChild ?? replacement;
    range.insertNode(replacement);
    range.setStartAfter(lastNode);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    savedSelectionRef.current = null;
    reportChange();
  };

  return <div className="overflow-hidden rounded-xl border border-slate-300 bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
    <div aria-label="원산지 글자 서식" className="flex h-11 items-center border-b border-slate-200 px-2">
      <button aria-label="선택한 글자 굵게" className="grid h-8 w-8 place-items-center rounded-md text-sm font-black text-slate-700 hover:bg-slate-100 disabled:opacity-40" disabled={disabled} onClick={toggleBold} onMouseDown={event => event.preventDefault()} onPointerDown={saveSelection} type="button">B</button>
    </div>
    <div aria-label="원산지 정보 입력" aria-multiline="true" className="min-h-48 max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words p-3 text-sm leading-6 outline-none" contentEditable={!disabled} onBeforeInput={event => {
      const inputType = (event.nativeEvent as InputEvent).inputType;
      if (inputType === "insertParagraph" || inputType === "insertLineBreak") {
        event.preventDefault();
        insertPlainText("\n");
      }
    }} onInput={reportChange} onKeyDown={event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggleBold();
      } else if (event.key === "Enter") {
        event.preventDefault();
        insertPlainText("\n");
      }
    }} onKeyUp={saveSelection} onPaste={event => {
      event.preventDefault();
      insertPlainText(event.clipboardData.getData("text/plain"));
    }} onPointerUp={saveSelection} ref={editorRef} role="textbox" suppressContentEditableWarning />
  </div>;
}
