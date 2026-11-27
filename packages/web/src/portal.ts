import {
  insert,
  installHostTagging,
  registerDelegatedContainer,
  unregisterDelegatedContainer,
  getDelegatedRoot
} from "./client.js";
import {
  createMemo,
  // @ts-expect-error `createOwner` is `@internal` in solid-js's declarations
  createOwner,
  createRoot,
  getOwner,
  runWithOwner,
  untrack,
  createEffect,
  createRenderEffect,
  type Owner
} from "solid-js";
import { sharedConfig } from "solid-js/internal";
import type { JSX } from "../jsx/jsx.js";

let claimPortal: ((start: Node) => void) | undefined;

export function Portal(props: {
  mount?: Element | ShadowRoot;
  children: JSX.Element;
}): JSX.Element {
  return runWithOwner(createOwner(), () => portalImpl(props)) as unknown as JSX.Element;
}

function portalImpl(props: { mount?: Element | ShadowRoot; children: JSX.Element }): JSX.Element {
  let kids: Node[] = [];
  const treeMarker = document.createTextNode(""),
    startMarker = document.createTextNode(""),
    endMarker = document.createTextNode(""),
    mount = () => props.mount || document.body,
    content = createMemo<JSX.Element>(
      () => {
        const prev = claimPortal;
        kids = [];
        claimPortal = n => kids.push(n);
        try {
          return [startMarker, props.children] as unknown as JSX.Element;
        } finally {
          claimPortal = prev;
        }
      },
      {
        ssrSource: "client",
        loadingValue: undefined
      }
    );

  claimPortal && claimPortal(startMarker);
  createRenderEffect<[Element | ShadowRoot, JSX.Element, Owner | null]>(
    () => [mount(), content(), getOwner()],
    ([, c, owner]) => {
      const m = untrack(mount);
      m.insertBefore(endMarker, kids.find(k => k.parentNode === m) || null);
      const dispose = runWithOwner(owner, () =>
        createRoot(d => {
          installHostTagging();
          insert(m, c, endMarker, undefined, { host: () => treeMarker.parentNode });
          return d;
        })
      );
      return () => {
        dispose!();
        let c: Node | null = startMarker;
        while (c) {
          const n: Node | null = c.nextSibling;
          m.removeChild(c);
          if (c === endMarker) break;
          c = n;
        }
      };
    },
    { schedule: true, ssrSource: "client" }
  );

  createEffect(
    mount,
    () => {
      const m = untrack(mount);
      const ownerRoot = getDelegatedRoot(treeMarker);
      if (!ownerRoot || (ownerRoot as Node).contains(m)) return;
      registerDelegatedContainer(m, ownerRoot);
      return () => unregisterDelegatedContainer(m, ownerRoot);
    },
    { ssrSource: "client" }
  );

  if (sharedConfig.hydrating)
    return createMemo<Text | undefined>(() => treeMarker, {
      ssrSource: "client",
      loadingValue: undefined
    }) as unknown as JSX.Element;
  return treeMarker as unknown as JSX.Element;
}
