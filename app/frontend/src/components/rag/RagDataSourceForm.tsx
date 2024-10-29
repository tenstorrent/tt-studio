// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

const RagDataSourceForm = ({
  onSubmit,
}: {
  onSubmit: ({ collectionName }: { collectionName: string }) => void;
}) => {
  const formSchema = z.object({
    name: z
      .string()
      .min(2, {
        message: "Collection name must be at least 2 characters.",
      })
      .regex(new RegExp(/^\S+$/), {
        message: "Collection name can not contain spaces",
      }),
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "" },
  });

  return (
    <div className="flex flex-col items-center my-4">
      <form
        className="flex  space-x-4 items-center"
        onSubmit={handleSubmit((d) => {
          onSubmit({ collectionName: d.name });
          reset();
        })}
      >
        <Input type="text" autoComplete="off" {...register("name")} />
        <Button type="submit"> Create New RAG Datasource</Button>
      </form>
      <div className="p-2">
        {errors.name?.message && (
          <p className="text-red-600 dark:text-red-400 text-sm font-medium">
            {errors.name?.message}
          </p>
        )}
      </div>
    </div>
  );
};

export default RagDataSourceForm;
