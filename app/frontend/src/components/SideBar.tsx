import React, { useState, forwardRef, useImperativeHandle } from "react";
import { Link } from "react-router-dom";
import { Menu, CircleX } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { AspectRatio } from "./ui/aspect-ratio";
import imagePath from "../assets/tt_line_graphics_1.png";
import { Button } from "./ui/button";

const Sidebar = forwardRef((_, ref) => {
  const [isOpen, setIsOpen] = useState(false);

  const toggleSidebar = () => {
    setIsOpen(!isOpen);
  };

  useImperativeHandle(ref, () => ({
    toggleSidebar,
  }));

  return (
    <div className="relative z-10">
      <div
        className={`fixed rounded-md right-0 top-12 h-5/6 flex flex-col bg-stone-900 text-white w-64 transform ${
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
            <h1 className="text-lg font-bold text-white">Help</h1>
            <Button onClick={toggleSidebar}>
              <CircleX className="w-6 h-6" />
            </Button>
          </div>
        </div>
        <nav className="flex-grow  p-10">
          <Card className="mb-4">
            <CardHeader>
              <CardTitle>Help Menu</CardTitle>
            </CardHeader>
            <CardContent>
              <Link
                to="/home"
                className="block py-2 px-4 hover:bg-gray-700 rounded"
              >
                Home
              </Link>
              <Link
                to="/about"
                className="block py-2 px-4 hover:bg-gray-700 rounded"
              >
                About
              </Link>
            </CardContent>
          </Card>
        </nav>
      </div>
      {/* <div className="flex-grow">
        <Button
          onClick={toggleSidebar}
          className={`p-4 md:hidden fixed right-0 top-0 ${
            isOpen ? "hidden" : "block"
          }`}
        >
          <Menu className="w-6 h-6" />
        
        </Button>
      </div> */}
    </div>
  );
});

export default Sidebar;
