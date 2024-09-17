# React + TypeScript + Vite + Tailwind

### Development

To start the development server with hot module replacement (HMR):

```bash
cd app/frontend
npm i # to build all modules
npm run dev
```

### Build

To create a production build:

```bash
npm run build
```

### Preview

To preview the production build locally:

```bash
npm run preview
```

### FrontEnd Project Structure

- `node_modules`: This directory contains all the dependencies of the project.

- `public`: This directory contains static files that are not processed by Webpack. These files are directly copied to the root of the dist directory.

- `tsconfig.node.json` and `tsconfig.json`: These files are used by TypeScript compiler to determine which files to compile and what compilation options to use.

- `vite.config.ts`: This is the configuration file for Vite, the build tool used in this project.

- `components.json`: This file contains metadata about the components.

- `package-lock.json` and `package.json`: These files contain information about the project's dependencies.

- `src`: This is the directory where the source code of the application resides.

- `tailwind.config.js`: This is the configuration file for Tailwind CSS, a utility-first CSS framework used in this project.

- `postcss.config.js`: This is the configuration file for PostCSS, a tool for transforming CSS with JavaScript.

- `index.html`: This is the main HTML file that is loaded when you visit the site.

- `UI`: This directory contains all shared components used across different parts of the application. Uses Shadcn UI components.

- `components`: This directory contains all the React components used in the project. One would begin here to start contributing and adding new components to be imported within various pages in the GUI.

- `pages`: This directory contains all the page components of the application. Each file corresponds to a route in the application. For example, `HomePage.tsx` would be the page and its nested components rendered when a user visits the home page of the application.

- `routes`: This directory contains the routing configuration for the application. It defines the paths for the application and maps them to the corresponding page components from the `pages` directory. This is where you define the application's navigation structure.

### Front End Dev Dependencies

#### Currently Project Uses

- [Shadcn UI](https://ui.shadcn.com/docs/components/navigation-menu) for generating UI components such as Button, Card, Table, etc.
- [Tailwind](https://tailwindcss.com/docs/guides/vite) for inline styling.
- [Aceternity UI](https://ui.aceternity.com/) for grid/dot background custom styling.

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type aware lint rules:

- Configure the top-level `parserOptions` property like this:

```js
export default {
  // other rules...
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    project: ["./tsconfig.json", "./tsconfig.node.json"],
    tsconfigRootDir: __dirname,
  },
};
```

- Replace `plugin:@typescript-eslint/recommended` to `plugin:@typescript-eslint/recommended-type-checked` or `plugin:@typescript-eslint/strict-type-checked`
- Optionally add `plugin:@typescript-eslint/stylistic-type-checked`
- Install [eslint-plugin-react](https://github.com/jsx-eslint/eslint-plugin-react) and add `plugin:react/recommended` & `plugin:react/jsx-runtime` to the `extends` list

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh


##  Prettier and ESLint Configuration
The project uses Prettier and ESLint with specific VS Code plugins to ensure code quality and consistency. Additionally, these tools are configured to automatically add the Tenstorrent license headers to the files in the project.

##  Auto-Adding License Headers
To ensure that the correct Tenstorrent license headers are added to each file, the project includes configurations for Prettier, ESLint, and specific VS Code plugins. The required SPDX license headers will be added automatically upon saving or formatting the files.

The license headers should look like this:

```js
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
```
