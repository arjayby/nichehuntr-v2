import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom keeps whatever the last test rendered, so each test unmounts its own tree rather than
// finding the previous one's Channels still in the document.
afterEach(cleanup);
