import React, { useState, forwardRef, useImperativeHandle } from "react";
import { Link } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";

const Sidebar = forwardRef((_, ref) => {
  const [isOpen, setIsOpen] = useState(false);

  const toggleSidebar = () => {
    setIsOpen(!isOpen);
  };

  useImperativeHandle(ref, () => ({
    toggleSidebar,
  }));

  return (
    <div className="relative z-50">
      <div
        className={`fixed right-0 top-0 h-full flex flex-col bg-gray-800 text-white w-64 transform ${
          isOpen ? "translate-x-0" : "translate-x-full"
        } transition-transform duration-300`}
      >
        <div className="flex items-center justify-between p-4">
          <h1 className="text-lg font-bold">Sidebar</h1>
          <button onClick={toggleSidebar} className="text-white">
            <X className="w-6 h-6" />
          </button>
        </div>
        <nav className="flex-grow px-4">
          <Card className="mb-4">
            <CardHeader>
              <CardTitle>Navigation</CardTitle>
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
              <Link
                to="/contact"
                className="block py-2 px-4 hover:bg-gray-700 rounded"
              >
                Contact
              </Link>
            </CardContent>
          </Card>
        </nav>
      </div>
      <div className="flex-grow">
        <button
          onClick={toggleSidebar}
          className={`p-4 md:hidden fixed right-0 top-0 ${
            isOpen ? "hidden" : "block"
          }`}
        >
          <Menu className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
});

export default Sidebar;
