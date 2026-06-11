import { render } from "solid-js/web";
import "./kit/app.css";
import "./studio/studio.css";
import { App } from "./studio/App";
import { initStudio } from "./studio/store";

void initStudio();
render(() => <App />, document.getElementById("app")!);
