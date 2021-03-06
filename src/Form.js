// @flow strict

import * as React from "react";

import type {
  MetaField,
  OnBlur,
  OnValidation,
  Extras,
  FieldLink,
  ServerErrors,
  ClientErrors,
} from "./types";
import {cleanMeta, cleanErrors} from "./types";
import {type FormState, replaceServerErrors} from "./formState";
import {
  type ShapedTree,
  type ShapedPath,
  treeFromValue,
  setFromKeysObj,
  updateAtPath,
} from "./shapedTree";

export type FormContextPayload = {
  shouldShowError: (meta: MetaField) => boolean,
  // These values are taken into account in shouldShowError, but are also
  // available in their raw form, for convenience.
  pristine: boolean,
  submitted: boolean,
};
export const FormContext: React.Context<
  FormContextPayload
> = React.createContext({
  shouldShowError: () => true,
  pristine: false,
  submitted: true,
});

function newFormState<T>(
  value: T,
  serverErrors: null | ShapedTree<T, ServerErrors>
): FormState<T> {
  const cleanState = [
    value,
    treeFromValue(value, {
      errors: cleanErrors,
      meta: cleanMeta,
    }),
  ];
  if (serverErrors != null) {
    return replaceServerErrors(serverErrors, cleanState);
  }
  return cleanState;
}

export type FeedbackStrategy =
  | "Always"
  | "OnFirstTouch"
  | "OnFirstChange"
  | "OnFirstSuccess"
  | "OnFirstSuccessOrFirstBlur"
  | "OnSubmit";

function getShouldShowError(strategy: FeedbackStrategy) {
  switch (strategy) {
    case "Always":
      return () => true;
    case "OnFirstTouch":
      return (meta: MetaField) => meta.touched;
    case "OnFirstChange":
      return (meta: MetaField) => meta.changed;
    default:
      throw new Error("Unimplemented feedback strategy: " + strategy);
  }
}

type Props<T> = {
  // This is *only* used to intialize the form. Further changes will be ignored
  +initialValue: T,
  +feedbackStrategy: FeedbackStrategy,
  +onSubmit: T => void,
  +serverErrors: null | {[path: string]: Array<string>},
  +children: (link: FieldLink<T>, onSubmit: () => void) => React.Node,
};
type State<T> = {
  formState: FormState<T>,
  pristine: boolean,
  submitted: boolean,
  oldServerErrors: null | {[path: string]: Array<string>},
};
export default class Form<T> extends React.Component<Props<T>, State<T>> {
  static getDerivedStateFromProps(props: Props<T>, state: State<T>) {
    if (props.serverErrors !== state.oldServerErrors) {
      const serverErrorsTree = Form.makeServerErrorTree(
        state.formState[0],
        props.serverErrors
      );
      return {
        formState: replaceServerErrors(serverErrorsTree, state.formState),
        oldServerErrors: props.serverErrors,
      };
    }
    return null;
  }

  static makeServerErrorTree<T>(
    value: T,
    errorsObj: null | {[path: string]: Array<string>}
  ): ShapedTree<T, ServerErrors> {
    if (errorsObj != null) {
      try {
        const freshTree = treeFromValue(value, []);
        // TODO(zach): Variance problems $FlowFixMe
        return (setFromKeysObj(errorsObj, freshTree): ShapedTree<
          T,
          ServerErrors
        >);
      } catch (e) {
        console.error("Error applying server errors to value!");
        console.error(`\t${e.message}`);
        console.error("The server errors will be ignored.");
        return treeFromValue(value, "unchecked");
      }
    } else {
      return treeFromValue(value, "unchecked");
    }
  }

  constructor(props: Props<T>) {
    super(props);

    const serverErrors = Form.makeServerErrorTree(
      props.initialValue,
      props.serverErrors
    );
    this.state = {
      formState: newFormState(props.initialValue, serverErrors),
      pristine: true,
      submitted: false,
      oldServerErrors: props.serverErrors,
    };
  }

  onSubmit = () => {
    this.setState({submitted: true});
    this.props.onSubmit(this.state.formState[0]);
  };

  updateFormState: (newValue: FormState<T>) => void = (
    newState: FormState<T>
  ) => {
    this.setState({formState: newState, pristine: false});
  };

  updateTree: OnBlur<T> = (newTree: ShapedTree<T, Extras>) => {
    this.setState({
      formState: [this.state.formState[0], newTree],
    });
  };

  updateTreeForValidation: OnValidation<T> = (
    path: ShapedPath<T>,
    errors: ClientErrors
  ) => {
    // TODO(zach): Move this into formState.js, it is gross
    const updater = newErrors => ({errors, meta}) => ({
      errors: {...errors, client: newErrors},
      meta: {
        ...meta,
        succeeded: newErrors.length === 0 ? true : meta.succeeded,
      },
    });
    this.setState(({formState: [value, tree]}) => ({
      formState: [value, updateAtPath(path, updater(errors), tree)],
    }));
  };

  render() {
    const {formState} = this.state;

    return (
      <FormContext.Provider
        value={{
          shouldShowError: getShouldShowError(this.props.feedbackStrategy),
          pristine: this.state.pristine,
          submitted: this.state.submitted,
        }}
      >
        {this.props.children(
          {
            formState,
            onChange: this.updateFormState,
            onBlur: this.updateTree,
            onValidation: this.updateTreeForValidation,
          },
          this.onSubmit
        )}
      </FormContext.Provider>
    );
  }
}
