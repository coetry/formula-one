// @flow strict

import {type Tree, type Path, leaf, strictZipWith} from "./tree";
import invariant from "./utils/invariant";
import {replaceAt} from "./utils/array";

// Shape is a phantom type used to track the shape of the Tree
// eslint-disable-next-line no-unused-vars
export opaque type ShapedTree<Shape, Data> = Tree<Data>;

// A path on a shaped tree
// eslint-disable-next-line no-unused-vars
export type ShapedPath<Shape> = Path;

// Take shape from value, data from nodeData
export function treeFromValue<T, NodeData>(
  value: T,
  nodeData: NodeData
): ShapedTree<T, NodeData> {
  if (Array.isArray(value)) {
    return {
      type: "array",
      data: nodeData,
      children: value.map(child => treeFromValue(child, nodeData)),
    };
  }

  if (value instanceof Object) {
    const objectValue = (value: {});
    return {
      type: "object",
      data: nodeData,
      children: Object.keys(objectValue).reduce(
        (children, k) => ({
          ...children,
          [k]: treeFromValue(objectValue[k], nodeData),
        }),
        {}
      ),
    };
  }

  return {
    type: "leaf",
    data: nodeData,
  };
}

function setKey<T, Node>(
  key: string,
  value: Node,
  tree: ShapedTree<T, Node>
): ShapedTree<T, Node> {
  if (key[0] !== "/") {
    throw new Error("Error paths must start with forward-slash");
  }
  return _setKey(key.slice(1), value, tree);
}

function _setKey<T, Node>(
  key: string,
  value: Node,
  tree: ShapedTree<T, Node>
): ShapedTree<T, Node> {
  if (key === "") {
    return mapRoot(() => value, tree);
  }

  const [firstPart, ...restParts] = key.split("/");

  if (tree.type === "leaf") {
    throw new Error("Theres more key, but not more Tree to match it against");
  }
  if (tree.type === "array") {
    const index = Number.parseInt(firstPart);
    invariant(
      index.toString() === firstPart,
      "Key indexing into an array is not a number"
    );
    invariant(index >= 0, "Key indexing into array is negative");
    invariant(
      index < tree.children.length,
      "Key indexing array is outside array bounds"
    );

    const newChild = _setKey(restParts.join("/"), value, tree.children[index]);
    // $FlowFixMe(zach): I think this is safe, might need GADTs for the type checker to understand why
    return dangerouslyReplaceArrayChild(index, newChild, tree);
  }
  if (tree.type === "object") {
    invariant(
      tree.children.hasOwnProperty(firstPart),
      "Key indexing into object does not exist"
    );

    const newChild = _setKey(
      restParts.join("/"),
      value,
      tree.children[firstPart]
    );
    // $FlowFixMe(zach): I think this is safe, might need GADTs for the type checker to understand why
    return dangerouslyReplaceObjectChild(firstPart, newChild, tree);
  }
  throw new Error("unreachable");
}
export function setFromKeysObj<T, Node>(
  keysObj: {[path: string]: Node},
  tree: ShapedTree<T, Node>
): ShapedTree<T, Node> {
  return Object.keys(keysObj).reduce(
    (memo: ShapedTree<T, Node>, key: string) => setKey(key, keysObj[key], memo),
    tree
  );
}

export function updateAtPath<T, Node>(
  path: ShapedPath<T>,
  updater: Node => Node,
  tree: ShapedTree<T, Node>
): ShapedTree<T, Node> {
  if (path.length === 0) {
    if (tree.type === "object") {
      return {
        type: "object",
        data: updater(tree.data),
        children: tree.children,
      };
    }
    if (tree.type === "array") {
      return {
        type: "array",
        data: updater(tree.data),
        children: tree.children,
      };
    }
    return {
      type: "leaf",
      data: updater(tree.data),
    };
  }

  const [firstStep, ...restStep] = path;
  if (tree.type === "leaf") {
    throw new Error("Theres more key, but not more Tree to match it against");
  }

  if (tree.type === "array") {
    invariant(
      firstStep.type === "array",
      "Trying to take a non-array path into an array"
    );
    const newChild = updateAtPath(
      restStep,
      updater,
      tree.children[firstStep.index]
    );
    // $FlowFixMe(zach): I think this is safe, might need GADTs for the type checker to understand why
    return dangerouslyReplaceArrayChild(firstStep.index, newChild, tree);
  }
  if (tree.type === "object") {
    invariant(
      firstStep.type === "object",
      "Trying to take a non-object path into an object"
    );
    const newChild = updateAtPath(
      restStep,
      updater,
      tree.children[firstStep.key]
    );
    // $FlowFixMe(zach): I think this is safe, might need GADTs for the type checker to understand why
    return dangerouslyReplaceObjectChild(firstStep.key, newChild, tree);
  }
  throw new Error("unreachable");
}

export function checkShape<T, Node>(
  value: T,
  tree: Tree<Node>
): ShapedTree<T, Node> {
  if (tree.type === "array") {
    invariant(Array.isArray(value), "value isn't an array");
    invariant(
      value.length === tree.children.length,
      "value and tree children have different lengths"
    );
    tree.children.forEach((child, i) => {
      checkShape(value[i], child);
    });
  }
  if (tree.type === "object") {
    invariant(value instanceof Object, "value isn't an object in checkTree");
    Object.keys(tree.children).forEach(k => {
      checkShape(value[k], tree.children[k]);
    });
  }
  // leaves are allowed to stand in for complex types in T
  return tree;
}

export function shapedArrayChild<E, Node>(
  index: number,
  tree: ShapedTree<Array<E>, Node>
): ShapedTree<E, Node> {
  invariant(
    tree.type === "array",
    "Tried to get an array child of a non-array node"
  );
  return tree.children[index];
}

export function shapedArrayChildren<E, Node>(
  tree: ShapedTree<Array<E>, Node>
): Array<ShapedTree<E, Node>> {
  invariant(
    tree.type === "array",
    "Tried to get an array children of a non-array node"
  );
  return tree.children.map(x => x);
}

// TODO(zach): not sure what to do about this output variable
export function shapedObjectChild<T: {}, Node, V>(
  key: string,
  tree: ShapedTree<T, Node>
): ShapedTree<V, Node> {
  invariant(
    tree.type === "object",
    "Tried to get object child of a non-object node"
  );
  return tree.children[key];
}

export function forgetShape<T, Node>(tree: ShapedTree<T, Node>): Tree<Node> {
  return tree;
}

export function mapRoot<T, Node>(
  f: Node => Node,
  tree: ShapedTree<T, Node>
): ShapedTree<T, Node> {
  if (tree.type === "object") {
    return {
      type: "object",
      data: f(tree.data),
      children: tree.children,
    };
  }
  if (tree.type === "array") {
    return {
      type: "array",
      data: f(tree.data),
      children: tree.children,
    };
  }
  return {
    type: "leaf",
    data: f(tree.data),
  };
}

// Do not use this unless you really know what you are doing
// It is unsafe, and intended to bypass some checks
export function dangerouslyReplaceObjectChild<T: {}, Node, V>(
  key: string,
  child: ShapedTree<V, Node>,
  tree: ShapedTree<T, Node>
): ShapedTree<T, Node> {
  invariant(
    tree.type === "object",
    "Tried to replace child of a non-object node"
  );
  return {
    type: "object",
    data: tree.data,
    children: {
      ...tree.children,
      [key]: child,
    },
  };
}

// Do not use this unless you really know what you are doing
// It is unsafe, and intended to bypass some checks
export function dangerouslyReplaceArrayChild<E, Node>(
  index: number,
  child: ShapedTree<E, Node>,
  tree: ShapedTree<Array<E>, Node>
): ShapedTree<Array<E>, Node> {
  invariant(
    tree.type === "array",
    "Tried to replace child of a non-array node"
  );
  return {
    type: "array",
    data: tree.data,
    children: replaceAt(index, child, tree.children),
  };
}

// Do not use this unless you really know what you are doing
// It is intended to bypass some checks when modifying arrays
export function dangerouslySetChildren<E, Node>(
  children: Array<ShapedTree<E, Node>>,
  tree: ShapedTree<Array<E>, Node>
): ShapedTree<Array<E>, Node> {
  invariant(tree.type === "array", "Tried to set children of a non-array node");
  return {
    type: "array",
    data: tree.data,
    children: children.map(forgetShape),
  };
}

// A leaf matches any shape
export function shapedLeaf<T, Node>(node: Node): ShapedTree<T, Node> {
  return leaf(node);
}

export function shapedZipWith<T, A, B, C>(
  f: (A, B) => C,
  left: ShapedTree<T, A>,
  right: ShapedTree<T, B>
): ShapedTree<T, C> {
  // Don't actually need the checks here if our invariant holds
  return strictZipWith(f, left, right);
}
