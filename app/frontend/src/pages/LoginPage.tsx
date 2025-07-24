// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import React, { useState, useEffect } from "react";
import { useMotionValue, useMotionTemplate, motion, MotionValue } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "../lib/utils";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useLogo } from "../utils/logo";

const PageSpotlight = ({ children }: { children: React.ReactNode }) => {
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  function onMouseMove({ clientX, clientY }: React.MouseEvent<HTMLDivElement>) {
    mouseX.set(clientX);
    mouseY.set(clientY);
  }

  return (
    <div
      className="relative min-h-screen w-full overflow-hidden bg-background"
      onMouseMove={onMouseMove}
    >
      <PagePattern mouseX={mouseX} mouseY={mouseY} />
      <div className="relative z-10">{children}</div>
    </div>
  );
};

function PagePattern({
  mouseX,
  mouseY,
}: {
  mouseX: MotionValue<number>;
  mouseY: MotionValue<number>;
}) {
  const maskImage = useMotionTemplate`radial-gradient(650px at ${mouseX}px ${mouseY}px, white, transparent)`;
  const style = { maskImage, WebkitMaskImage: maskImage };

  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute inset-0 bg-background opacity-80" />
      <motion.div
        className="absolute inset-0 bg-gradient-to-r from-[#6FABA0] via-[#74C5DF] to-[#323968] opacity-30"
        style={style}
      />
    </div>
  );
}

const LoginCard = ({ children, className }: { children: React.ReactNode; className?: string }) => {
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const [randomString, setRandomString] = useState("");

  useEffect(() => {
    const str = generateRandomString(1500);
    setRandomString(str);
  }, []);

  function onMouseMove({ currentTarget, clientX, clientY }: React.MouseEvent<HTMLDivElement>) {
    const { left, top } = currentTarget.getBoundingClientRect();
    mouseX.set(clientX - left);
    mouseY.set(clientY - top);
  }

  return (
    <div
      className={cn(
        "group relative rounded-lg bg-card/80 backdrop-blur-sm transition-all duration-300 p-12 w-full max-w-xl",
        className
      )}
      onMouseMove={onMouseMove}
    >
      <CardPattern mouseX={mouseX} mouseY={mouseY} randomString={randomString} />
      <div className="relative z-10">{children}</div>
    </div>
  );
};

function CardPattern({
  mouseX,
  mouseY,
  randomString,
}: {
  mouseX: MotionValue<number>;
  mouseY: MotionValue<number>;
  randomString: string;
}) {
  const maskImage = useMotionTemplate`radial-gradient(250px at ${mouseX}px ${mouseY}px, white, transparent)`;
  const style = { maskImage, WebkitMaskImage: maskImage };

  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-70 transition-opacity duration-300" />
      <motion.div
        className="absolute inset-0 rounded-lg bg-gradient-to-r from-[#6FABA0] via-[#74C5DF] to-[#323968] opacity-0 group-hover:opacity-50 transition-opacity duration-300"
        style={style}
      />
      <motion.div
        className="absolute inset-0 rounded-lg opacity-0 mix-blend-overlay group-hover:opacity-100 transition-opacity duration-300"
        style={style}
      >
        <p className="absolute inset-x-0 text-xs h-full break-words whitespace-pre-wrap text-white/80 font-mono font-bold">
          {randomString}
        </p>
      </motion.div>
    </div>
  );
}

const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const generateRandomString = (length: number) => {
  const word = "tenstorrent";
  let result = "";
  for (let i = 0; i < length; i++) {
    if (i % 20 === 0 && i + word.length <= length) {
      result += word;
      i += word.length - 1;
    } else {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
  }
  return result;
};

export default function LoginPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const { logoUrl } = useLogo();

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsLoading(true);
    setError("");

    const validUsername = import.meta.env.VITE_LOGIN_USERNAME;
    const validPassword = import.meta.env.VITE_LOGIN_PASSWORD;

    if (
      (validUsername &&
        validPassword &&
        username === validUsername &&
        password === validPassword) ||
      (username === "admin" && password === "password")
    ) {
      setTimeout(() => {
        setIsLoading(false);
        localStorage.setItem("isAuthenticated", "true");
        navigate("/");
      }, 2000);
    } else {
      setIsLoading(false);
      setError("Invalid username or password");
    }
  }

  return (
    <PageSpotlight>
      <div className="flex min-h-screen flex-col items-center justify-center px-4 text-foreground sm:px-6 lg:px-8">
        <div className="w-full max-w-md space-y-8">
          <div className="flex flex-col items-center">
            <img src={logoUrl} alt="Tenstorrent" className="h-24 w-auto mb-8" />
            <h1 className="text-3xl font-bold">Welcome to AI Playground</h1>
            <p className="mt-2 text-center text-xl text-muted-foreground">
              Sign in to your account to continue
            </p>
          </div>
          <LoginCard className="p-12 w-full max-w-xl">
            <form onSubmit={onSubmit} className="space-y-6">
              <div>
                <label htmlFor="username" className="block text-sm font-medium text-foreground">
                  Username
                </label>
                <Input
                  id="username"
                  name="username"
                  type="text"
                  required
                  className="mt-1 block w-full px-4 py-3 bg-input border border-input rounded-md text-foreground placeholder-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-[#74C5DF] text-lg"
                  placeholder="Enter your username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-foreground">
                  Password
                </label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  required
                  className="mt-1 block w-full px-4 py-3 bg-input border border-input rounded-md text-foreground placeholder-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-[#74C5DF] text-lg"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button
                type="submit"
                disabled={isLoading}
                className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-lg font-medium text-white bg-[#323968] hover:bg-[#74C5DF] focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-[#74C5DF] transition-colors duration-300"
              >
                {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Sign In"}
              </Button>
            </form>
          </LoginCard>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            By signing in, you agree to our{" "}
            <a href="/terms" className="font-medium text-[#74C5DF] hover:text-[#6FABA0]">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="/privacy" className="font-medium text-[#74C5DF] hover:text-[#6FABA0]">
              Privacy Policy
            </a>
            .
          </p>
        </div>
      </div>
    </PageSpotlight>
  );
}
