import type { ComponentKind } from "../kernel/types";
import type { KitDef } from "./kitdef";
import { Button, Label } from "./defs/text";
import { Checkbox, NumberInput, Select, TextArea, TextInput } from "./defs/inputs";
import { Card, Container } from "./defs/layout";
import { Table } from "./defs/data";
import { Modal, Toast } from "./defs/overlay";

// The complete v1 kit. Record over the ComponentKind union, so a missing
// (or extra) kind is a type error.
export const KIT: Record<ComponentKind, KitDef> = {
  Label,
  Button,
  TextInput,
  NumberInput,
  Checkbox,
  Select,
  TextArea,
  Container,
  Card,
  Table,
  Modal,
  Toast,
};

export type { KitDef, Instance, PropSpec, EventSpec, MountCtx } from "./kitdef";
export { resolveProps } from "./kitdef";
