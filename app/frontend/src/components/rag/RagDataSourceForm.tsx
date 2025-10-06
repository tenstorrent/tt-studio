// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, AlertCircle } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { customToast } from "../CustomToaster";

const RagDataSourceForm = ({
  onSubmit,
}: {
  onSubmit: ({ collectionName }: { collectionName: string }) => Promise<void>;
}) => {
  const formSchema = z.object({
    name: z
      .string()
      .min(2, {
        message: "Collection name must be at least 2 characters.",
      })
      .regex(new RegExp(/^\S+$/), {
        message: "Collection name cannot contain spaces",
      }),
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "" },
  });

  const onSubmitForm = async (data: z.infer<typeof formSchema>) => {
    try {
      await onSubmit({ collectionName: data.name });
      // Only reset if no error was thrown
      reset();
    } catch (error) {
      console.error("Error creating RAG Datasource:", error);
      if (error instanceof Error) {
        customToast.error(error.message);
      } else {
        customToast.error("Failed to create RAG Datasource. Please try again.");
      }
    }
  };

  const handleFormSubmit = handleSubmit((data) => {
    if (Object.keys(errors).length > 0) {
      // Show toast for validation errors
      Object.values(errors).forEach((error) => {
        if (error?.message) {
          customToast.error(error.message);
        }
      });
    } else {
      onSubmitForm(data);
    }
  });

  return (
    <div className="w-full max-w-4xl mx-auto my-4">
      <form
        className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-4 items-start sm:items-center"
        onSubmit={handleFormSubmit}
      >
        <div className="grow relative w-full p-2">
          <Input
            type="text"
            autoComplete="off"
            placeholder="Enter collection name"
            className={`w-full ${errors.name ? "border-red-500" : ""}`}
            {...register("name")}
          />
          {errors.name && (
            <div className="absolute right-3 top-1/2 transform -translate-y-1/2 text-red-500">
              <AlertCircle size={18} />
            </div>
          )}
        </div>
        <Button type="submit" disabled={isSubmitting} className="w-auto self-center sm:self-auto">
          <Plus className="mr-2 h-4 w-4" />
          <span className="hidden sm:inline">
            {isSubmitting ? "Creating..." : "Create New RAG Datasource"}
          </span>
          <span className="sm:hidden">{isSubmitting ? "Creating..." : "Create"}</span>
        </Button>
      </form>
      {errors.name && (
        <p className="text-red-600 dark:text-red-400 text-sm font-medium mt-2">
          {errors.name.message}
        </p>
      )}
    </div>
  );
};

export default RagDataSourceForm;
