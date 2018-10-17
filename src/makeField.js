// @flow strict

import * as React from "react";
import type {FieldLink, Validation, Err} from "./types";
import {mapRoot} from "./shapedTree";
import {FormContext, type FormContextPayload} from "./Form";
import {setExtrasTouched, getExtras, setChanged, validate} from "./formState";

function getErrors(errors: Err) {
  let flatErrors = [];
  if (errors.client !== "pending") {
    flatErrors = flatErrors.concat(errors.client);
  }
  if (errors.server !== "unchecked") {
    flatErrors = flatErrors.concat(errors.server);
  }
  return flatErrors;
}

export default function makeField<T>(
  Component: React.ComponentType<{|
    value: T,
    errors: $ReadOnlyArray<string>,
    onChange: T => void,
    onBlur: () => void,
  |}>
): React.ComponentType<{|
  link: FieldLink<T>,
  // TODO(zach): This shouldn't need to be optional
  validation?: Validation<T>,
|}> {
  class Field extends React.Component<{|
    link: FieldLink<T>,
    validation: Validation<T>,
    formContext: FormContextPayload,
  |}> {
    static defaultProps = {
      validation: () => [],
    };

    initialValidate() {
      const {
        link: {formState, onValidation},
        validation,
      } = this.props;
      const {errors} = getExtras(this.props.link.formState);

      if (errors.client === "pending") {
        const [_, newTree] = validate(validation, formState);
        onValidation(newTree);
      }
    }

    componentDidMount() {
      this.initialValidate();
    }

    onChange: T => void = (newValue: T) => {
      const [_, oldTree] = this.props.link.formState;
      this.props.link.onChange(
        setChanged(validate(this.props.validation, [newValue, oldTree]))
      );
    };

    onBlur = () => {
      const [_, tree] = this.props.link.formState;

      this.props.link.onBlur(
        // TODO(zach): Not sure if we should blow away server errors here
        mapRoot(setExtrasTouched, tree)
      );
    };

    render() {
      const [value] = this.props.link.formState;
      const {meta, errors} = getExtras(this.props.link.formState);
      const flatErrors = this.props.formContext.shouldShowError(meta)
        ? getErrors(errors)
        : [];
      return (
        <Component
          value={value}
          errors={flatErrors}
          onChange={this.onChange}
          onBlur={this.onBlur}
        />
      );
    }
  }

  // Using a HOC here is not possible due to a Flow bug: https://github.com/facebook/flow/issues/6903
  return function(
    props: $Diff<
      React.ElementConfig<typeof Field>,
      {+formContext: FormContextPayload}
    >
  ) {
    return (
      <FormContext.Consumer>
        {formContext => <Field {...props} formContext={formContext} />}
      </FormContext.Consumer>
    );
  };
}
