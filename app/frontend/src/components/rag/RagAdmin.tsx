// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import { useState } from "react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Card } from "@/src/components/ui/card";
import { ScrollArea, ScrollBar } from "@/src/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";
import CopyableText from "@/src/components/CopyableText";
import { useTheme } from "@/src/providers/ThemeProvider";
import CustomToaster, { customToast } from "@/src/components/CustomToaster";
import { Spinner } from "@/src/components/ui/spinner";
import axios from "axios";
import {
  FileType,
  Key,
  Fingerprint,
  User,
  Calendar,
  Lock,
  Unlock,
  UserCheck,
  Globe,
  AlertTriangle,
} from "lucide-react";

// Interface for RagDataSource with admin fields
interface AdminRagDataSource {
  id: string;
  name: string;
  metadata: Record<string, string>;
  user_type: string;
  user_identifier: string;
}

export default function RagAdmin() {
  const [password, setPassword] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [collections, setCollections] = useState<AdminRagDataSource[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { theme } = useTheme();

  // Function to authenticate
  const handleAuthenticate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      customToast.error("Password cannot be empty");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await axios.post("/collections-api/admin/authenticate", {
        password,
      });

      if (response.data.authenticated) {
        setIsAuthenticated(true);
        customToast.success("Authentication successful");
        fetchCollections();
      } else {
        customToast.error("Authentication failed");
        setError("Invalid credentials");
      }
    } catch (err: any) {
      console.error("Authentication error:", err);
      customToast.error(err.response?.data?.error || "Authentication failed");
      setError(err.response?.data?.error || "Authentication failed");
    } finally {
      setIsLoading(false);
    }
  };

  // Function to fetch all collections as admin
  const fetchCollections = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await axios.post("/collections-api/admin/collections", {
        password,
      });

      setCollections(response.data);
      customToast.success(`Retrieved ${response.data.length} collections`);
    } catch (err: any) {
      console.error("Error fetching collections:", err);
      customToast.error(
        err.response?.data?.error || "Failed to fetch collections"
      );
      setError(err.response?.data?.error || "Failed to fetch collections");

      // If unauthorized, log out
      if (err.response?.status === 401) {
        setIsAuthenticated(false);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Logout function
  const handleLogout = () => {
    setIsAuthenticated(false);
    setPassword("");
    setCollections([]);
    customToast.success("Logged out successfully");
  };

  // User icon based on type
  const getUserIcon = (userType: string) => {
    if (userType === "Authenticated User") {
      return <UserCheck className="w-4 h-4 text-green-500" />;
    } else if (userType === "Anonymous (Browser Session)") {
      return <Globe className="w-4 h-4 text-blue-500" />;
    } else {
      return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
    }
  };

  if (!isAuthenticated) {
    return (
      <Card
        className={`${theme === "dark" ? "bg-zinc-900 text-zinc-200" : "bg-white text-black border-gray-500"} border-2 rounded-lg p-6 max-w-md mx-auto`}
      >
        <CustomToaster />
        <div className="flex items-center justify-center mb-6">
          <Lock className="w-8 h-8 mr-2 text-red-500" />
          <h2 className="text-2xl font-bold">RAG Admin Authentication</h2>
        </div>

        <form onSubmit={handleAuthenticate}>
          <div className="mb-4">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter admin password"
              className="w-full"
              autoComplete="current-password"
            />
          </div>

          <Button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 hover:bg-blue-700"
          >
            {isLoading ? <Spinner /> : <Key className="w-4 h-4 mr-2" />}
            {isLoading ? "Authenticating..." : "Login to Admin"}
          </Button>

          {error && <p className="mt-4 text-red-500 text-center">{error}</p>}
        </form>
      </Card>
    );
  }

  return (
    <Card
      className={`${theme === "dark" ? "bg-zinc-900 text-zinc-200" : "bg-white text-black border-gray-500"} border-2 rounded-lg p-6 w-full mx-auto`}
    >
      <CustomToaster />
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center">
          <Unlock className="w-8 h-8 mr-2 text-green-500" />
          <h2 className="text-2xl font-bold">RAG Admin Panel</h2>
        </div>

        <Button onClick={handleLogout} className="bg-red-600 hover:bg-red-700">
          <Lock className="w-4 h-4 mr-2" />
          Logout
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center items-center h-64">
          <Spinner />
        </div>
      ) : (
        <ScrollArea className="whitespace-nowrap rounded-md border">
          <Table className="rounded-lg">
            <TableCaption className="text-TT-black dark:text-TT-white text-xl">
              All Collections ({collections.length})
            </TableCaption>
            <TableHeader>
              <TableRow
                className={theme === "dark" ? "bg-zinc-900" : "bg-zinc-200"}
              >
                <TableHead className="text-left">
                  <div className="flex items-center gap-2">
                    <Fingerprint className="w-4 h-4" />
                    ID
                  </div>
                </TableHead>
                <TableHead className="text-left">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4" />
                    Name
                  </div>
                </TableHead>
                <TableHead className="text-left">
                  <div className="flex items-center gap-2">
                    <UserCheck className="w-4 h-4" />
                    User Type
                  </div>
                </TableHead>
                <TableHead className="text-left">
                  <div className="flex items-center gap-2">
                    <Fingerprint className="w-4 h-4" />
                    User ID
                  </div>
                </TableHead>
                <TableHead className="text-left">
                  <div className="flex items-center gap-2">
                    <FileType className="w-4 h-4" />
                    File Name
                  </div>
                </TableHead>
                <TableHead className="text-left">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    Creation Time
                  </div>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {collections.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="text-left">
                    <CopyableText text={item.id} />
                  </TableCell>
                  <TableCell className="text-left">
                    <CopyableText text={item.name} />
                  </TableCell>
                  <TableCell className="text-left">
                    <div className="flex items-center gap-2">
                      {getUserIcon(item.user_type)}
                      <span>{item.user_type}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-left">
                    <CopyableText text={item.user_identifier} />
                  </TableCell>
                  <TableCell className="text-left">
                    {item.metadata?.last_uploaded_document ? (
                      <div className="flex items-center gap-2">
                        <FileType color="red" className="w-4 h-4" />
                        <CopyableText
                          text={item.metadata.last_uploaded_document}
                        />
                      </div>
                    ) : (
                      "No file uploaded"
                    )}
                  </TableCell>
                  <TableCell className="text-left">
                    {item.metadata?.created_at || "Unknown"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      )}
    </Card>
  );
}
