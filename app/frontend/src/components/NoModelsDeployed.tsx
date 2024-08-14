import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { useNavigate } from "react-router-dom";

export function NoModelsDialog() {
  const navigate = useNavigate();

  return (
    <Dialog open={true}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>No Models Deployed</DialogTitle>
          <DialogDescription>
            There are currently no models deployed. You can head to the homepage
            to deploy models.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => navigate("/")}>Go to Homepage</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
