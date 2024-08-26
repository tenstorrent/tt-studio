// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import React, { useState, forwardRef, useImperativeHandle } from "react";
import { useLocation } from "react-router-dom";
import { Menu, CircleX } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { AspectRatio } from "./ui/aspect-ratio";
import imagePath from "../assets/tt_line_graphics_1.png";
import { Button } from "./ui/button";
import { useTheme } from "../providers/ThemeProvider";

const Sidebar = forwardRef((_, ref) => {
  const [isOpen, setIsOpen] = useState(false);
  const { theme } = useTheme();
  const location = useLocation();

  const toggleSidebar = () => {
    setIsOpen(!isOpen);
  };

  const getHelpContent = () => {
    const baseStyles = `shadow-lg rounded-lg p-6 my-4 ${
      theme === "dark" ? "bg-TT-slate text-white" : "bg-white text-tt-black"
    }`;

    return (
      {
        "/": (
          <Card className={baseStyles}>
            <CardHeader>
              <CardTitle className="text-2xl font-bold text-left">
                Home
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-lg leading-relaxed text-left">
                The "Home" page serves as your central hub for exploring the
                various features of the LLM Studio app. Use the dropdown to
                browse and select from a list of available models, and click the
                "Deploy" button to begin the process.
              </p>
              <ul className="list-disc text-sm mt-4 space-y-3 pl-6 text-left">
                <ul className="list-disc text-sm mt-4 space-y-3 pl-6 text-left">
                  <li>
                    <strong>Model Selection:</strong> Start by selecting a model
                    from the dropdown menu. This is the first step in
                    configuring your deployment.
                  </li>
                  <li>
                    <strong>Weight Selection:</strong> After choosing a model,
                    select the appropriate weights for your model to ensure
                    optimal performance.
                  </li>
                  <li>
                    <strong>Deploy Model:</strong> Once you’ve configured the
                    model and selected the weights, click the "Deploy" button to
                    initiate the deployment process.
                  </li>
                  <li>
                    <strong>Navigation:</strong> Use the "Next" and "Previous"
                    buttons at the bottom to move between these steps as needed.
                  </li>
                </ul>
              </ul>
            </CardContent>
          </Card>
        ),
        "/chat-ui": (
          <Card className={baseStyles}>
            <CardHeader>
              <CardTitle className="text-2xl font-bold text-left">
                ChatUI
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-lg leading-relaxed text-left">
                The "ChatUI" page allows you to interact with your deployed
                models in a conversational format. You can ask questions,
                provide input, and receive responses from the models you have
                deployed.
              </p>
              <ul className="list-disc text-sm mt-4 space-y-3 pl-6 text-left">
                <li>
                  <strong>Entering Queries:</strong> Type your questions in the
                  input box at the bottom.
                </li>
                <li>
                  <strong>Response Display:</strong> Responses from the model
                  will appear on the left side.
                </li>
              </ul>
            </CardContent>
          </Card>
        ),
        "/models-deployed": (
          <Card className={baseStyles}>
            <CardHeader>
              <CardTitle className="text-2xl font-bold text-left">
                Models Deployed
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-lg leading-relaxed text-left">
                The "Models Deployed" page gives you an overview of all models
                currently running in your environment. From here, you can manage
                your models, check their health status, and access specific
                tools like the ChatUI.
              </p>
              <ul className="list-disc text-sm mt-4 space-y-3 pl-6 text-left">
                <li>
                  <strong>Monitoring Models:</strong> Each row displays a
                  model's status and health indicators.
                </li>
                <li>
                  <strong>Actions:</strong> Use the "Delete" button to stop and
                  remove a model.
                </li>
              </ul>
            </CardContent>
          </Card>
        ),
      }[location.pathname] || null
    );
  };

  useImperativeHandle(ref, () => ({
    toggleSidebar,
  }));

  return (
    <div className="relative z-10">
      <div
        className={`fixed rounded-md right-0 top-0 h-full flex flex-col ${
          theme === "dark" ? "bg-TT-black text-white" : "bg-white text-black"
        } w-2/6 transform ${
          isOpen ? "translate-x-0" : "translate-x-full"
        } transition-transform duration-300`}
      >
        <div className="relative w-full">
          <AspectRatio ratio={28 / 9} className="relative rounded-md">
            <img
              src={imagePath}
              alt="Header Image"
              className="w-full h-full object-cover rounded-md"
            />
          </AspectRatio>
          <div className="absolute top-0 left-0 w-full h-full flex items-center justify-between p-4 bg-gradient-to-b from-black/50 to-transparent">
            <h1 className="text-lg font-bold">Help</h1>
            <Button onClick={toggleSidebar}>
              <CircleX className="w-6 h-6" />
            </Button>
          </div>
        </div>
        <nav className="flex-grow p-4 overflow-y-auto">{getHelpContent()}</nav>
      </div>
      <Button
        onClick={toggleSidebar}
        className={`p-4 md:hidden fixed right-0 top-0 ${
          isOpen ? "hidden" : "block"
        }`}
      >
        <Menu className="w-6 h-6" />
      </Button>
    </div>
  );
});

export default Sidebar;
