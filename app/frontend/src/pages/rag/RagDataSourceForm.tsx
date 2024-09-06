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
  } = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "" },
  });

  return (
    <div className="flex flex-col items-center my-4">
      <form
        className="flex  space-x-4 items-center"
        onSubmit={handleSubmit((d) => onSubmit({ collectionName: d.name }))}
      >
        <Input {...register("name")} />
        <Button type="submit"> Create New RAG Datasource</Button>
      </form>
      <div>{errors.name?.message && <p>{errors.name?.message}</p>}</div>
    </div>
  );
};

export default RagDataSourceForm;
